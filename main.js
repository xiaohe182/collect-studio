'use strict';
/**
 * 采集助手 V6 - 主进程
 * 类八爪鱼桌面采集工具：Electron 主窗口(左控制面板) + WebContentsView(右内置浏览器)
 */
const { app, BrowserWindow, WebContentsView, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const pagecode = require('./engine/pagecode');
const {executeInput} = require('./engine/input-action');
let selectionEnabled = true;
const { Scraper } = require('./engine/orchestrator');
const { exportRows, exportRowsAsync } = require('./engine/exporter');
const resultIO = require('./engine/result-io');
const { loadTask, saveTask, resultsDir, tasksDir, listTasks, getTask, archiveTask, deleteArchivedTask, listGroups, addGroup, updateTaskMeta, deleteTask, deleteGroup, renameGroup } = require('./engine/storage');
const Workflow = require('./engine/workflow');

// 八爪鱼式布局：顶部工具栏 48 / 右侧工作流面板 320 / 底部数据预览 232，中间为内置浏览器
const TOP_H = 44, SIDE_W = 360, PREVIEW_H = 268;
let previewCollapsed = true;
let sidebarWidth=SIDE_W;

// 伪装成正常 Chrome，去掉 Electron 特征
app.userAgentFallback =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
  process.versions.chrome + ' Safari/537.36';

// 采集窗口切到后台/被遮挡时不节流渲染和定时器（否则自动滚动会变慢、界面可能不绘制）
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

let win = null;
let view = null;
let runView = null;
let scraper = null;
let startingRun = false, startCancelled = false;
let detecting = false;
let detectCancelled = false;
let opTipEnabled = true; // 「操作提示」浮窗开关（用户点 × 后本会话不再弹）

// 面板当前的任务配置（识别结果 / 手动微调都写回这里）
let taskCfg = { url: '', list: null, fields: [], nextSel: null };
// 采集到的数据（主进程持有全量，面板只拿预览）
let allRows = [];
let liveRows=new Map(),liveOrder=[],liveCollection=null,resultJournal=null;
function clearLiveRows(){liveRows.clear();liveOrder=[];liveCollection=null;}
function setLiveRow(id,row){if(!liveRows.has(id))liveOrder.push(id);liveRows.set(id,row);}
function resultSlice(start,end){const rows=allRows.slice(start,Math.min(end,allRows.length));for(let i=Math.max(0,start-allRows.length);i<Math.min(liveOrder.length,end-allRows.length);i++)rows.push(liveRows.get(liveOrder[i]));return rows;}
let resultFields = [];
let runLogs=[],runSummary=null,runStarted=0;
let runViewport=null;
function editorViewport(){const b=view.getBounds(),zoom=view.webContents.getZoomFactor();return {width:Math.max(1,Math.round(b.width/zoom)),height:Math.max(1,Math.round(b.height/zoom))};}
function createRunScraper(executionView,executionCfg,opts){
  clearLiveRows();
  const instance=new Scraper(executionView,{cfg:executionCfg,opts,onLog:log,onProgress:p=>{if(p.phase==='page-done'){resultJournal?.write({type:'clear'});clearLiveRows();}sendPanel('scrape',p);},
    onRows:rows=>{resultJournal?.write({type:'commit',rows});clearLiveRows();for(const row of rows)allRows.push(row);sendPanel('rows',{total:allRows.length,sample:allRows.slice(0,100)});},
    onDone:async summary=>{log((summary.stopped?'采集已停止':'采集完成')+'，共 '+allRows.length+' 条数据');await finishRun(summary);sendPanel('scrape',{phase:'done',...summary,total:allRows.length});sendPanel('rows',{total:allRows.length,sample:allRows.slice(0,100)});scraper=null;},
    onError:async err=>{
      if(instance.browserCleanupFailed){
        win?.contentView.removeChildView(executionView);
        if(!executionView.webContents.isDestroyed())executionView.webContents.close();
        if(runView===executionView){runView=null;runViewport=null;}
        log('浏览器策略恢复失败，已关闭本次执行网页；下次采集将新建独立会话');
      }
      log('采集失败：'+err+'；已保留 '+allRows.length+' 条数据');
      await finishRun({error:err,...(instance.browserCleanupFailed?{executionRetired:true}:{})});
      sendPanel('scrape',{phase:'error',message:err});scraper=null;
    }
  });
  for(const key of ['onRows','onDone','onError','onProgress','onLog']){const callback=instance[key];instance[key]=(...args)=>{if(scraper===instance)return callback(...args);};}
  return instance;
}
async function finishRun(summary){
  if((summary.stopped||summary.error)&&liveRows.size){
    const count=liveRows.size;for(const row of liveRows.values())allRows.push(row);
    log('已保留当前页 '+count+' 条数据；本页尚未完成，部分列可能仍为空');
    sendPanel('rows',{total:allRows.length,sample:allRows.slice(0,100)});
  }
  clearLiveRows();
  resultJournal?.write({type:'end',summary});
  runSummary={...summary,at:new Date().toISOString(),name:taskCfg.name||'未命名任务',durationMs:scraper?.elapsedMs()??summary.durationMs??0,total:allRows.length};
  try {
    const folder=path.join(tasksDir(),'runs');await fs.promises.mkdir(folder,{recursive:true});
    const file=path.join(folder,Date.now()+'.json'),data={summary:runSummary,fields:resultFields,rows:allRows,logs:runLogs};
    if(resultJournal)await resultJournal.snapshot(file,data);else await fs.promises.writeFile(file,JSON.stringify(data));
  } catch(error){log('采集记录保存失败：'+error.message);}
}
function runFile(id){
  if(!/^\d+$/.test(String(id)))throw Error('采集记录编号无效');
  return path.join(tasksDir(),'runs',id+'.json');
}

// ---------------- 工具 ----------------
function normalizeUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u;
}

function exec(code, ...args) {
  if (!view) return Promise.resolve({ ok: false, error: 'browser not ready' });
  const argSrc = args.map(a => JSON.stringify(a == null ? null : a)).join(',');
  return view.webContents.executeJavaScript(`(${code})(${argSrc})`, true)
    .then(r => r && r.ok === false ? r : (r === undefined ? { ok: false, error: 'no return' } : { ok: true, data: r }))
    .catch(err => ({ ok: false, error: String(err && err.message || err).slice(0, 300) }));
}

function sendPanel(type, payload) {
  if (win && !win.isDestroyed()) win.webContents.send('panel-event', { type, payload });
}

function log(msg) {
  if(scraper) {runLogs.push({time:new Date().toISOString(),message:msg});if(runLogs.length>1000)runLogs.shift();}
  sendPanel('log', { msg: `[${new Date().toLocaleTimeString()}] ${msg}` });
}

function updateViewBounds() {
  if (!win || win.isDestroyed() || !view) return;
  const [w, h] = win.getContentSize();
  view.setBounds({
    x: 0, y: TOP_H,
    width: Math.max(200, w - Math.min(sidebarWidth,Math.max(SIDE_W,w-320))),
    height: Math.max(0, h - TOP_H - (previewCollapsed ? 52 : PREVIEW_H)),
  });
}

function waitLoad(timeoutMs) {
  const wc = view && view.webContents;
  if (!wc) return Promise.resolve();
  if (!wc.isLoading()) return new Promise(r => setTimeout(r, 600));
  return new Promise(resolve => {
    let done = false;
    const finish = () => { if (!done) { done = true; clearTimeout(timer);wc.removeListener('did-stop-loading',finish);wc.removeListener('destroyed',finish);setTimeout(resolve, 200); } };
    const timer=setTimeout(finish, timeoutMs || 20000);
    wc.once('did-stop-loading', finish);
    wc.once('destroyed',finish);
    if(!wc.isLoading())finish();
  });
}

// ---------------- 窗口 ----------------
function createWindow() {
  win = new BrowserWindow({
    width: 1560, height: 920,
    minWidth: 1100, minHeight: 640,
    frame: false,
    icon: path.join(__dirname, 'styles', 'app.ico'),
    title: '采集助手 V6',
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  if (process.argv.includes('--style-devtools')) win.webContents.once('did-finish-load', () => win.webContents.openDevTools({mode:'detach'}));

  view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'page-preload.js'),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.contentView.addChildView(view);
  updateViewBounds();
  view.setVisible(true);

  // 每次页面加载完，弹出「操作提示」浮窗（采集运行中或用户已关闭时不再弹）
  const isAutotest = process.argv.includes('--autotest');
  view.webContents.on('did-finish-load', () => {
    if (isAutotest || scraper || detecting) return;
    if(selectionEnabled)exec(pagecode.pickCode(),true).then(()=>sendPanel('pick-mode',{on:true}));
    else if(opTipEnabled)exec(pagecode.opTipCode(), 'show');
  });

  // 内置浏览器里打开新页面 → 仍在本视图内打开（类浏览器行为），非 http 一律拦截
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      view.webContents.loadURL(url).catch(() => {});
    } else {
      log('已拦截弹窗：' + url.slice(0, 120));
    }
    return { action: 'deny' };
  });

  const navEvent = () => {
    const wc = view.webContents;
    sendPanel('nav', {
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canBack: wc.navigationHistory.canGoBack(),
      canFwd: wc.navigationHistory.canGoForward(),
    });
  };
  ['did-start-loading', 'did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']
    .forEach(ev => view.webContents.on(ev, navEvent));
  view.webContents.on('did-fail-load', (_e, code, desc, url) => {
    if (code !== -3) log(`页面加载失败(${code}) ${desc} ${url.slice(0, 80)}`);
  });

  win.on('resize', updateViewBounds);
  win.on('maximize', () => sendPanel('window-state', { maximized: true }));
  win.on('unmaximize', () => sendPanel('window-state', { maximized: false }));
  // 菜单栏在首次显示时占用客户区高度，需要重新对齐原生网页。
  win.once('ready-to-show', updateViewBounds);
  win.on('closed', () => { if(runView&&!runView.webContents.isDestroyed())runView.webContents.close();runView=null;win = null; });
  updateViewBounds();
}

// ---------------- 识别 / 点选 ----------------
async function doDetect() {
  if (!view) return { ok: false, error: '浏览器未就绪' };
  if (detecting || scraper) return { ok:false, error:'请先停止当前操作' };
  detecting = true; detectCancelled = false;
  try {
  if (view.webContents.isLoading()) await waitLoad();
  if(detectCancelled) return {ok:false,cancelled:true};
  await exec(pagecode.highlightCode(), taskCfg, false);
  await exec(pagecode.opTipCode(), 'hide');
  await exec(pagecode.guideCode(),{phase:'progress',message:'正在滚动页面，检查是否加载更多内容…'});
  const scan = await exec(pagecode.prepareDetectCode());
  if(!scan.ok) return scan;
  if(detectCancelled || scan.data.cancelled) return {ok:false,cancelled:true};
  const r = await exec(pagecode.detectCode());
  if (!r.ok) { log('识别失败：' + (r.error || '未知')); return r; }
  const d = r.data;
  log(`识别完成：${d.candidates.length} 个候选，最优 ${d.candidates[0] ? d.candidates[0].count + ' 项 / ' + d.candidates[0].fields.length + ' 字段' : '无'}`);
  return { ok: true, data: d, scan:scan.data };
  } finally { detecting = false; }
}

// ---------------- IPC ----------------
function registerIpc() {
  ipcMain.handle('panel-cmd', async (_e, cmd, payload) => {
    try {
      if ((scraper||startingRun) && ['load-url','apply-cfg','task-open','task-archive','task-new','reload','nav-back','nav-fwd'].includes(cmd)) return { ok: false, error: '请先停止采集' };
      if (detecting && ['load-url','apply-cfg','task-open','task-archive','task-new','reload','nav-back','nav-fwd','scrape-start','pick','preview-page','highlight'].includes(cmd)) return {ok:false,error:'请先停止识别'};
      switch (cmd) {
        case 'browser-identities': return {ok:true,userAgents:[
          {name:'桌面 Chrome',value:app.userAgentFallback},
          {name:'Android Chrome',value:'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/'+process.versions.chrome+' Mobile Safari/537.36'}
        ]};
        case 'task-list': {
          const catalog=await resultIO.readTaskCatalog(tasksDir());
          return {ok:true,tasks:catalog.tasks,groups:catalog.groups};
        }
        case 'task-open': {
          const loaded = getTask(payload.id);
          if (loaded.url!=='about:blank'&&!/^https?:\/\//i.test(loaded.url)) return { ok: false, error: '任务网址无效' };
            taskCfg = loaded; allRows = []; resultFields = [];
            // 任务切换不等待远端页面；后续导航取消当前加载属于正常浏览器行为。
            view.webContents.loadURL(loaded.url).catch(error=>{
              if(error.code==='ERR_ABORTED'||error.errno===-3)return;
              if(taskCfg!==loaded)return;
              log('任务网页加载失败：'+error.message);
              sendPanel('task-load-error',{id:loaded.id,message:'任务已打开，但网页加载失败，请点击刷新重试。'});
            });
            return { ok: true, cfg: taskCfg };
        }
        case 'task-create-named': {
          if(scraper||detecting)return {ok:false,error:'请先停止当前操作'};
          if(!String(payload.name||'').trim())return {ok:false,error:'请输入任务名称'};
          const created={name:payload.name.trim(),group:String(payload.group||'').trim(),url:'about:blank',fields:[],flow:[]};
          if(created.group)addGroup(created.group);
          if(!saveTask(created))throw Error('创建任务失败');return {ok:true,cfg:created};
        }
        case 'task-group-delete': {
          if(scraper||detecting)return {ok:false,error:'请先停止当前操作'};
          const name=payload.name,catalog=await resultIO.readTaskCatalog(tasksDir());if(!name||!catalog.groups.includes(name))return {ok:false,error:'分组不存在'};
          const count=[...catalog.tasks,...catalog.archivedTasks].filter(t=>t.group===name).length;
          const choice=await dialog.showMessageBox(win,{type:'warning',title:'删除分组',message:'确定删除分组“'+name+'”？',detail:'分组内共 '+count+' 个任务。不勾选时移到未分组；勾选后永久删除任务配置，已采集数据保留。',checkboxLabel:'同时删除分组内任务',checkboxChecked:false,buttons:['取消','删除分组'],defaultId:0,cancelId:0,noLink:true});
          if(choice.response!==1)return {ok:true,cancelled:true};
          const deletedTasks=choice.checkboxChecked===true;
          const affected=deleteGroup(name,deletedTasks);
          if(taskCfg?.group===name){if(deletedTasks)taskCfg={url:'',fields:[],flow:[]};else taskCfg.group='';}
          return {ok:true,affected,deletedTasks};
        }
        case 'task-group-rename': {
          if(scraper||detecting)return {ok:false,error:'请先停止当前操作'};
          const name=renameGroup(payload.oldName,payload.name);
          if(taskCfg?.group===payload.oldName)taskCfg.group=name;
          return {ok:true,name};
        }
        case 'task-group-create': return {ok:true,groups:addGroup(payload.name)};
        case 'task-meta': {
          if(scraper||detecting)return {ok:false,error:'请先停止当前操作'};
          const updated=updateTaskMeta(payload.id,!!payload.archived,payload.changes||{});
          if(taskCfg?.id===updated.id)Object.assign(taskCfg,{name:updated.name,group:updated.group});return {ok:true,cfg:updated};
        }
        case 'task-export-png': {
          const task=getTask(payload.id);
          const chosen=await dialog.showSaveDialog(win,{title:'导出流程 PNG',defaultPath:(task.name||'任务').replace(/[<>:"/\\|?*]/g,'_')+'-流程.png',filters:[{name:'PNG 高清流程图',extensions:['png']}]});
          if(chosen.canceled||!chosen.filePath)return {ok:true,cancelled:true};
          const size=await require('./engine/flow-export').exportFlowPng(task,chosen.filePath);
          return {ok:true,path:chosen.filePath,...size};
        }
        case 'task-delete': {
          if(scraper||detecting)return {ok:false,error:'请先停止当前操作'};
          const task=getTask(payload.id,!!payload.archived);
          const result=await dialog.showMessageBox(win,{type:'warning',title:'删除任务',message:'永久删除任务“'+task.name+'”？',detail:'任务配置无法恢复，已采集数据保留。',buttons:['取消','删除'],defaultId:0,cancelId:0,noLink:true});
          if(result.response!==1)return {ok:true,cancelled:true};
          deleteTask(payload.id,!!payload.archived);return {ok:true};
        }
        case 'task-new': {
          await view.webContents.loadURL('about:blank');
          taskCfg = { url: '', list: null, fields: [], nextSel: null };
          allRows = []; resultFields = [];
          return { ok: true };
        }
        case 'task-delete-batch': {
          if(scraper||detecting)return {ok:false,error:'请先停止当前操作'};
          const ids=[...new Set(payload.ids||[])];
          if(!ids.length)return {ok:false,error:'请先勾选任务'};
          const tasks=ids.map(id=>getTask(id,false));
          const confirmation=await dialog.showMessageBox(win,{type:'warning',title:'删除任务',message:'确定永久删除所选 '+ids.length+' 个任务？',detail:tasks.slice(0,10).map(t=>t.name||t.id).join('\n')+(tasks.length>10?'\n等 '+tasks.length+' 个任务':'')+'\n删除后无法恢复；已采集的数据保留。',buttons:['取消','删除'],defaultId:0,cancelId:0,noLink:true});
          if(confirmation.response!==1)return {ok:true,cancelled:true};
          const deleted=[],failed=[];
          for(const id of ids){try{deleteTask(id,false);deleted.push(id);}catch(error){failed.push({id,error:error.message});}}
          return {ok:true,deleted,failed};
        }
        

        case 'window-minimize': win.minimize(); return { ok: true };
        case 'window-maximize': {
          if (win.isMaximized()) win.unmaximize();
          else win.maximize();
          return { ok: true, maximized: win.isMaximized() };
        }
        case 'window-close': win.close(); return { ok: true };
        case 'sidebar-resize': {
          const [width]=win.getContentSize();
          sidebarWidth=Math.max(SIDE_W,Math.min(Number(payload.width)||SIDE_W,SIDE_W*2,width-320));
          updateViewBounds();return {ok:true,width:sidebarWidth};
        }
        case 'preview-collapse': {
          previewCollapsed = payload.collapsed === true;
          updateViewBounds();
          return { ok: true, collapsed: previewCollapsed };
        }
        case 'load-url': {
          if (scraper) return { ok: false, error: '请先停止采集再打开新网页' };
          const url = normalizeUrl(payload.url);
          if (!url) return { ok: false, error: '网址为空' };
          taskCfg.url = url;
          allRows = [];
          resultFields = [];
          taskCfg = { url, list: null, fields: [], nextSel: null };
          const saved = payload.fresh ? null : loadTask(url);
          if (saved) {
            taskCfg = saved;
            log('已自动载入该站点保存过的采集规则');
          }
          await view.webContents.loadURL(url);
          return { ok: true, restored: !!saved, cfg: saved };
        }
        case 'nav-back': view.webContents.navigationHistory.goBack(); return { ok: true };
        case 'nav-fwd': view.webContents.navigationHistory.goForward(); return { ok: true };
        case 'reload': view.webContents.reload(); return { ok: true };
        case 'stop-load': view.webContents.stop(); return { ok: true };
        case 'detect': return await doDetect();
        case 'guide': return await exec(pagecode.guideCode(),payload);
        case 'detail-selector':return await exec(pagecode.detailSelectorCode(),payload.path,payload.list);
        case 'reveal-list':return await exec(pagecode.revealListCode(),payload.list);
        case 'detect-stop':
          detectCancelled = true;
          await exec('() => { window.__v6detectStopped = true; return true; }');
          return {ok:true};
        case 'preview-page': return await exec(pagecode.previewCode(), payload);
        case 'suggest-list': return await exec(pagecode.suggestListCode(),payload);
        case 'apply-cfg': {
          const draft = structuredClone(taskCfg);
          draft.list = payload.list;
          draft.fields = payload.fields;
          if (payload.nextSel !== undefined) draft.nextSel = payload.nextSel;
          if (payload.url) draft.url = payload.url;
          draft.opts = payload.opts || draft.opts;
          draft.nodeNames = payload.nodeNames || draft.nodeNames;
          if (payload.flow) Workflow.validate(payload.flow);
          draft.flow = payload.flow || draft.flow;
          draft.id = payload.id || draft.id;
          draft.name = payload.name || draft.name;
          draft.group = payload.group || '';
          draft.viewport=payload.viewport||draft.viewport||editorViewport();
          if(!saveTask(draft))return {ok:false,error:'规则保存失败，请检查任务编号、目录权限及磁盘空间'};
          taskCfg=draft;return {ok:true,cfg:taskCfg};
        }
        case 'highlight': {
          const r = await exec(pagecode.highlightCode(), payload.cfg, !!payload.on);
          return r;
        }
        case 'node-target-xpath': {
          return exec(require('./engine/node-target').inspectTarget.toString(),payload);
        }
        case 'pick': {
          selectionEnabled=!!payload.on;
          if(payload.on)taskCfg.viewport=editorViewport();
          if(payload.on)await exec(pagecode.guideCode(),null);
          // 点选时先收起「操作提示」浮窗，避免挡住页面；结束后恢复
          await exec(pagecode.opTipCode(), payload.on ? 'hide' : (opTipEnabled ? 'show' : 'hide'));
          const r = await exec(pagecode.pickCode(), !!payload.on);
          return r;
        }
        case 'discover-table': {
          if(scraper||detecting)return {ok:false,error:'请先停止当前操作'};
          taskCfg.viewport=editorViewport();
          detecting=true;
          try{return await exec(require('./engine/generic-table').genericTable.toString(),payload.path);}
          finally{detecting=false;}
        }
        case 'resolve-pick': {
          if (view.webContents.isLoading()) await waitLoad();
          const r = await exec(pagecode.resolvePickCode(), payload.path, payload.role, payload.cfg || taskCfg, payload.selectionList);
          return r;
        }
        case 'run-picked-action': {
          if(scraper||detecting)return {ok:false,error:'请先停止当前操作'};
          if(!['click','hover'].includes(payload.type))return {ok:false,error:'无效操作'};
          await exec(pagecode.pickCode(),false);
          sendPanel('pick-off',{});
          const result=await exec(pagecode.flowActionCode(),{type:payload.type,params:{selector:payload.selector,mode:'css'}},taskCfg,null);
          if(payload.type==='click')await waitLoad();
          if(selectionEnabled&&!view.webContents.isLoading()){await exec(pagecode.pickCode(),true);sendPanel('pick-mode',{on:true});}
          return result;
        }
        case 'run-input': {
          if(scraper||detecting)return {ok:false,error:'请先停止当前操作'};
          await exec(pagecode.pickCode(),false);
          try {
            const result=await executeInput(view.webContents,payload,taskCfg,null);
            if(payload.enter)await waitLoad();
            return result;
          } finally {
            if(selectionEnabled&&!view.webContents.isLoading())await exec(pagecode.pickCode(),true);
          }
        }
        case 'scrape-start': {
          if (scraper||startingRun) return { ok: false, error: '已有任务在运行' };
          startingRun=true;startCancelled=false;
          let preparingJournal=null,preparingView=null,startCommitted=false;
          try{
          const repaired=view.webContents.getURL()?await exec(pagecode.repairTableControlsCode(),payload):{ok:false};
          if(repaired.ok&&repaired.data?.removed.length){
            payload=repaired.data.cfg;
            sendPanel('table-controls-repaired',{cfg:payload,removed:repaired.data.removed});
          }
          if(view.webContents.getURL())await exec(pagecode.guideCode(),null);
          if ((!payload.flow || Workflow.hasExtract(payload.flow)) && (!payload.list || !payload.fields?.length)) return { ok: false, error: '请配置列表及至少一个字段' };
          if (payload.flow) Workflow.validate(payload.flow);
          if(payload.flow&&!Workflow.hasExtract(payload.flow)&&!payload.allowNoExtract)return {ok:false,error:'流程没有提取数据步骤，无法采集数据'};
          if (!payload.flow) {
            const validation = await exec(pagecode.previewCode(), payload);
            if (!validation.ok) return validation;
          }
          taskCfg.list = payload.list;
          taskCfg.fields = payload.fields;
          taskCfg.nextSel = payload.nextSel || null;
          taskCfg.opts = payload.opts || {};
          taskCfg.nodeNames = payload.nodeNames || {};
          taskCfg.flow = payload.flow || null;
          taskCfg.url = payload.url || taskCfg.url;
          taskCfg.id = payload.id || taskCfg.id;
          taskCfg.name = payload.name || taskCfg.name;
          taskCfg.group = payload.group || ''; 
          saveTask(taskCfg);
          const previousJournal=resultJournal;resultJournal=null;
          try{await previousJournal?.close();}catch(error){log('上次备份关闭失败，将新建备份：'+error.message);}
          if(startCancelled)return {ok:true,cancelled:true};
          const nextStarted=Date.now();
          const nextJournal=preparingJournal=new (require('./engine/result-journal').ResultJournal)(path.join(resultsDir(),'采集备份-'+nextStarted+'.jsonl'),error=>{log('实时备份失败：'+error);sendPanel('backup-error',{message:error});});
          try{await nextJournal.flush();}catch(error){await nextJournal.close().catch(()=>{});throw error;}
          if(startCancelled)return {ok:true,cancelled:true};
          if(runView){win.contentView.removeChildView(runView);runView.webContents.close();}
          // 每次执行使用独立内存会话，关闭执行网页后释放 Cookie 与缓存。
          const runPartition='scrape-run-'+require('node:crypto').randomUUID();
          runView=new WebContentsView({webPreferences:{partition:runPartition,preload:path.join(__dirname,'page-preload.js'),backgroundThrottling:false,contextIsolation:true,nodeIntegration:false}});
          preparingView=runView;
          win.contentView.addChildView(runView);
          // 隐藏时也要保留有效视口，否则 Chromium 可能不投递键盘输入。
          const editorBounds=view.getBounds();
          runView.setBounds({x:0,y:0,width:Math.max(800,editorBounds.width),height:Math.max(600,editorBounds.height)});
          runView.setVisible(false);
          const executionView=runView;
          runViewport=taskCfg.viewport||editorViewport();
          executionView.webContents.setWindowOpenHandler(({url})=>{if(!executionView.webContents.__v6BlockPopups&&/^https?:\/\//i.test(url))executionView.webContents.loadURL(url).catch(()=>{});return {action:'deny'};});
          await executionView.webContents.loadURL('about:blank');
          await require('./engine/run-viewport').lockRunViewport(executionView.webContents,runViewport);
          const executionCfg=structuredClone(taskCfg);
          if(executionCfg.flow?.find(n=>n.enabled!==false)?.type!=='open'){
            const open=Workflow.node('open');open.params.url=taskCfg.url||view.webContents.getURL();
            executionCfg.flow=[open,...(executionCfg.flow||Workflow.defaults().slice(1))];
          }
          if(startCancelled)return {ok:true,cancelled:true};
          resultJournal=nextJournal;
          allRows=[];runLogs=[];runSummary=null;runStarted=nextStarted;
          resultFields=structuredClone(Workflow.resultFields(payload));
          resultJournal.write({type:'start',name:taskCfg.name,fields:resultFields,at:runStarted});
          scraper = createRunScraper(executionView,executionCfg,payload.opts||{});
          startCommitted=true;
          scraper.run().catch(err => {
            log('采集异常：' + err.message);
            sendPanel('scrape', { phase: 'error', message: err.message });
            scraper = null;
          });
          return { ok: true };
          }catch(error){if(startCancelled)return {ok:true,cancelled:true};throw error;}
          finally{
            if(!startCommitted){
              if(preparingView&&!preparingView.webContents.isDestroyed()){win?.contentView.removeChildView(preparingView);preparingView.webContents.close();if(runView===preparingView)runView=null;}
              await preparingJournal?.close().catch(error=>log('准备阶段备份关闭失败：'+error.message));
            }
            if(startCancelled&&!startCommitted)sendPanel('scrape',{phase:'done',stopped:true,total:allRows.length});
            startingRun=false;
          }
        }
        case 'scrape-stop': {
          if(startingRun)startCancelled=true;
          scraper?.stop();
          return { ok: true };
        }
        case 'export': {
          if (!allRows.length) return { ok: false, error: '没有可导出的数据' };
          const fields = resultFields.length ? resultFields : (taskCfg.fields || []);
          const r = await exportRowsAsync(allRows, fields, payload.format, resultsDir());
          if (r.ok) { log('已导出：' + r.path); sendPanel('export', { path: r.path }); }
          return r;
        }
        case 'open-results': shell.openPath(resultsDir()); return { ok: true };
        case 'open-path': shell.showItemInFolder(payload.path); return { ok: true };
        case 'get-state': {
          return { ok: true, cfg: taskCfg, total: allRows.length, sample: allRows.slice(0, 100) };
        }
        case 'run-results': {
          if(payload.id)return {ok:true,...await resultIO.readRunPage(runFile(payload.id),payload.page)};
          const size=100,total=allRows.length+(scraper?liveOrder.length:0);
          const requested=Number(payload.page),page=Math.min(Math.max(0,Math.ceil(total/size)-1),Math.max(0,Number.isFinite(requested)?Math.floor(requested):0));
          return {ok:true,summary:scraper?{running:true,pending:liveOrder.length,durationMs:scraper.elapsedMs(),duplicates:scraper.duplicates,filtered:scraper.filtered}:runSummary||{running:false},fields:resultFields,rows:resultSlice(page*size,(page+1)*size),total,logs:runLogs.slice(-500),page,pageSize:size,backup:resultJournal?.file};
        }
        case 'recover-result-backup': {
          if(scraper)return {ok:false,error:'请先停止当前采集再恢复备份'};
          const previousRows=allRows,previousTask=taskCfg;
          const picked=await dialog.showOpenDialog(win,{title:'恢复采集数据备份',defaultPath:resultsDir(),properties:['openFile'],filters:[{name:'采集文本备份',extensions:['jsonl']}]});
          if(picked.canceled)return {ok:true,canceled:true};
          const recovered=await resultIO.readJournalAsync(picked.filePaths[0]);
          if(scraper||allRows!==previousRows||taskCfg!==previousTask)return {ok:false,error:'任务或结果已变化，请重新选择要恢复的备份'};
          allRows=recovered.rows;resultFields=recovered.fields;clearLiveRows();runSummary={stopped:true,total:allRows.length,name:'恢复的采集备份'};
          sendPanel('rows',{total:allRows.length,sample:allRows.slice(0,100)});return {ok:true,total:allRows.length};
        }
        case 'rename-result-field': {
          if(scraper)return {ok:false,error:'采集中不能修改字段名称'};
          const {index,oldName,name}=payload;
          if(!Number.isInteger(index)||index<0||typeof name!=='string'||!name.trim()||name.length>80)return {ok:false,error:'字段名称无效'};
          if(resultFields[index]?.name===oldName)resultFields[index].name=name;
          return {ok:true};
        }
        case 'transform-result-columns': {
          if(scraper)return {ok:false,error:'采集中不能更改列'};
          const {order,expected}=payload;
          if(!Array.isArray(expected)||!Array.isArray(order)||!order.length||new Set(order).size!==order.length||order.some(i=>!Number.isInteger(i)||i<0||i>=expected.length))return {ok:false,error:'列顺序无效'};
          const signature=f=>JSON.stringify([f.name,f.type,f.rel,f.xpath,f.index]);
          if(resultFields.length===expected.length&&resultFields.every((f,i)=>signature(f)===signature(expected[i]))){
            resultFields=order.map(i=>resultFields[i]);allRows=allRows.map(row=>order.map(i=>row[i]));
          }
          return {ok:true};
        }
        case 'export-run': return await resultIO.exportRunAsync(runFile(payload.id),payload.format,resultsDir());
        case 'run-history': return {ok:true,history:await resultIO.listRunHistory(path.join(tasksDir(),'runs'))};
        case 'export-logs': {
          await fs.promises.mkdir(resultsDir(),{recursive:true});const file=path.join(resultsDir(),'logs-'+Date.now()+'.txt');
          if(payload.id)return await resultIO.exportRunLogsAsync(runFile(payload.id),file);
          await fs.promises.writeFile(file,runLogs.map(item=>`[${item.time}] ${item.message}`).join('\n'));return {ok:true,path:file};
        }
        case 'panel-dialog': {
          // 原生网页位于渲染层之上，弹窗期间以同尺寸画面保留表格背景。
          let backdrop=null;
          if(payload.open&&payload.keepPage){
            try{backdrop={image:(await view.webContents.capturePage()).toDataURL(),bounds:view.getBounds()};}
            catch(error){if(!error.message.includes('Current display surface not available'))throw error;}
          }
          view.setVisible(!payload.open);runView?.setVisible(false);return {ok:true,backdrop};
        }
        case 'run-page': {
          if(!runView)return {ok:true,available:false};
          if(payload.visible&&payload.bounds){const b=payload.bounds;runView.setBounds({x:Math.round(b.x),y:Math.round(b.y),width:Math.max(1,Math.round(b.width)),height:Math.max(1,Math.round(b.height))});if(runViewport)await require('./engine/run-viewport').lockRunViewport(runView.webContents,runViewport,b);}
          runView.setVisible(!!payload.visible);
          return {ok:true,available:true,url:runView.webContents.getURL()};
        }
        case 'devtools': win.webContents.openDevTools({ mode: 'detach' }); return { ok: true };
        case 'page-devtools': view.webContents.openDevTools({ mode: 'detach' }); return { ok: true };
        default: return { ok: false, error: 'unknown cmd ' + cmd };
      }
    } catch (err) {
      log('命令出错 ' + cmd + ': ' + err.message);
      return { ok: false, error: err.message };
    }
  });

  // 目标页面桥（点选结果、操作提示浮窗按钮等）
  ipcMain.on('page-msg', (_e, msg) => {
    if (!msg || !msg.type) return;
    if(msg.type==='collect-preview'&&scraper&&_e.sender===runView?.webContents){
      const p=msg.payload;
      if(liveCollection!==p.id){clearLiveRows();liveCollection=p.id;}
      const sourceIndexes=new Map(p.fields.map((field,index)=>[field.name,index]));
      const indexes=resultFields.map(f=>sourceIndexes.get(f.name)??-1);
      const updates=p.rows.map(row=>({id:row.id,values:indexes.map(i=>i<0?'':row.values[i])}));
      for(const row of updates)setLiveRow(row.id,row.values);
      resultJournal?.write({type:'preview',collection:p.id,rows:updates});
      const sample=allRows.slice(0,100);
      if(sample.length<100)for(const row of liveRows.values()){sample.push(row);if(sample.length===100)break;}
      sendPanel('rows',{total:allRows.length+liveRows.size,sample});
      return;
    }
    if(msg.type==='guide' && _e.sender===view?.webContents)sendPanel('guide',msg.payload);
    if (detecting && msg.type === 'detect-progress' && _e.sender === view?.webContents) sendPanel('detect-progress', msg.payload);
    if (scraper && msg.type === 'collect-progress' && _e.sender === runView?.webContents) {
      const p=msg.payload;
      log(p.repair?'正在自动补扫第 '+p.repair+' 次，补齐当前页缺失的行列':'滚动第 '+p.round+' 轮：当前页 '+p.rows+' 条，耗时 '+p.seconds+' 秒，'+(p.atEnd?'已到底，稳定 '+p.stable+' 轮':'尚未到底'));
      sendPanel('scrape',{phase:'scroll',...p});
    }
    if (msg.type === 'pick') sendPanel('pick', msg.payload);
    if (['record-input','record-captcha'].includes(msg.type)&&_e.sender===view?.webContents)sendPanel(msg.type,msg.payload);
    if (msg.type === 'pick-action' && _e.sender===view?.webContents) sendPanel('pick-action',msg.payload);
    if (msg.type === 'pick-off') sendPanel('pick-off', {});
    if (msg.type === 'optip') {
      if (msg.payload && msg.payload.action === 'dismiss') opTipEnabled = false;
      sendPanel('optip', msg.payload);
    }
  });
}

// ---------------- 自动化测试模式 ----------------
// 用法: AUTOTEST_URL=<url> AUTOTEST_PAGES=2 AUTOTEST_SCROLLSEC=15 AUTOTEST_OUT=前缀 electron . --autotest
async function runAutotest() {
  const env = process.env;
  const url = normalizeUrl(env.AUTOTEST_URL || 'https://quotes.toscrape.com/');
  const maxPages = parseInt(env.AUTOTEST_PAGES || '1', 10);
  const scrollSec = parseInt(env.AUTOTEST_SCROLLSEC || '25', 10);
  const outPrefix = env.AUTOTEST_OUT || null;

  // 注意：隐藏窗口不渲染布局（innerHeight=0），自动测试需要真实渲染
  win = new BrowserWindow({ show: true, width: 1400, height: 900, webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  view = new WebContentsView({ webPreferences: { preload: path.join(__dirname, 'page-preload.js') } });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 1400, height: 900 });

  const t0 = Date.now();
  const P = s => {
    console.log('AUTOTEST: ' + s);
    try { fs.appendFileSync(path.join(__dirname, 'autotest-result.txt'), s + '\n', 'utf8'); } catch (e) {}
  };
  try { fs.writeFileSync(path.join(__dirname, 'autotest-result.txt'), '', 'utf8'); } catch (e) {}
  try {
    P('load ' + url);
    await view.webContents.loadURL(url);
    await waitLoad();
    P('loaded in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's, title=' + view.webContents.getTitle());

    const d = await exec(pagecode.detectCode());
    if (!d.ok) throw new Error('detect failed: ' + d.error);
    const best = d.data.candidates[0];
    if (!best) throw new Error('no candidate found');
    P(`detect: ${d.data.candidates.length} candidates, best score=${best.score} count=${best.count} fields=[${best.fields.map(f => f.name).join(',')}]`);
    P('detect samples: ' + JSON.stringify(best.samples[0] || []).slice(0, 400));

    const cfg = { url, list: best.list, fields: best.fields.map(f => ({ name: f.name, type: f.type, rel: f.rel, index: f.index })), nextSel: null };
    let rows = [];
    const sc = new Scraper(view, {
      cfg, opts: { autoNext: maxPages > 1, maxPages, maxScrollSec: scrollSec, scrollLoad: true },
      onLog: () => {},
      onProgress: p => { if (p.phase === 'page') P(`page ${p.page}: ${p.items} items`); if (p.phase === 'page-done') P(`page ${p.page} done: +${p.added} (rounds=${p.rounds})`); },
      onRows: r => { rows.push(...r); },
      onDone: s => P(`done: pages=${s.pages} rows=${s.totalRows} in ${((Date.now() - t0) / 1000).toFixed(1)}s`),
      onError: e => P('error: ' + e),
    });
    await sc.run();
    P('total rows: ' + rows.length);
    if (rows.length) P('first row: ' + JSON.stringify(rows[0]).slice(0, 400));
    if (outPrefix) {
      const fields = cfg.fields;
      const r = exportRows(rows, fields, 'xlsx', resultsDir(), outPrefix);
      P('export: ' + JSON.stringify(r));
      const r2 = exportRows(rows, fields, 'csv', resultsDir(), outPrefix);
      P('export: ' + JSON.stringify(r2));
    }
    P('PASS');
  } catch (err) {
    P('FAIL ' + err.message);
  } finally {
    setTimeout(() => app.exit(0), 300);
  }
}

// ---------------- UI 自动化测试模式 ----------------
// 用法: UITEST_URL=<url> electron . --uitest
// 通过真实面板 UI 代码路径驱动：输入网址 → 识别 → 高亮 → 采集 → 导出，各阶段截图
async function runUiTest() {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const shotsDir = path.join(__dirname, 'test', 'shots');
  fs.mkdirSync(shotsDir, { recursive: true });
  try { fs.writeFileSync(path.join(__dirname, 'uitest-result.txt'), '', 'utf8'); } catch (e) {}
  const P = s => {
    console.log('UITEST: ' + s);
    try { fs.appendFileSync(path.join(__dirname, 'uitest-result.txt'), s + '\n', 'utf8'); } catch (e) {}
  };
  const url = process.env.UITEST_URL || 'http://127.0.0.1:8931/sample1.html';

  createWindow();
  await sleep(3000);
  const wc = win.webContents;
  const shot = async name => {
    try {
      const img = await wc.capturePage();
      fs.writeFileSync(path.join(shotsDir, name + '.png'), img.toPNG());
    } catch (e) { P('shot fail ' + name + ': ' + e.message); }
  };
  const viewShot = async name => {
    try {
      const img = await view.webContents.capturePage();
      fs.writeFileSync(path.join(shotsDir, name + '.png'), img.toPNG());
    } catch (e) { P('viewshot fail ' + name + ': ' + e.message); }
  };

  try {
    // 1. 通过面板真实 go() 加载网址
    await wc.executeJavaScript(`document.getElementById('urlInput').value = ${JSON.stringify(url)}; go(); true`);
    await sleep(9000);
    await shot('01-loaded');
    await viewShot('01-page');
    P('url loaded, panel url=' + await wc.executeJavaScript(`document.getElementById('urlInput').value`));

    // 2. 点「自动识别」→ 应自动在页面框选出来
    await wc.executeJavaScript(`document.getElementById('btnDetect').click(); true`);
    await sleep(5000);
    await shot('02-detected');
    await viewShot('02-highlight');
    const detectState = await wc.executeJavaScript(`JSON.stringify({
      candidates: document.getElementById('candSelect').options.length,
      fields: document.querySelectorAll('#fieldList .field-row').length,
      visible: !document.getElementById('detectResult').classList.contains('hidden'),
      highlightBtn: '默认高亮',
      log: document.getElementById('log').textContent.slice(-120)
    })`);
    P('detect UI: ' + detectState);
    const framed = await view.webContents.executeJavaScript(`JSON.stringify({
      framedItems: document.querySelectorAll('[data-v6hl]').length,
      framedFields: document.querySelectorAll('[data-v6fld]').length
    })`);
    P('framing on page: ' + framed);

    // 3. 采集（带着高亮一起跑，验证框选不影响采集）
    await wc.executeJavaScript(`document.getElementById('optPages').value='1';
      document.getElementById('optScrollSec').value='8';
      document.getElementById('btnStart').click(); true`);
    await sleep(18000);
    await shot('04-scraped');
    const scrapeState = await wc.executeJavaScript(`JSON.stringify({
      rows: document.getElementById('rowCount').textContent,
      cols: document.querySelectorAll('#dataTable thead th').length,
      rowsShown: document.querySelectorAll('#dataTable tbody tr').length,
      progress: document.getElementById('progressText').textContent
    })`);
    P('scrape UI: ' + scrapeState);

    // 5. 导出 Excel
    await wc.executeJavaScript(`document.getElementById('btnXlsx').click(); true`);
    await sleep(2500);
    await shot('05-export');
    P('export UI: ' + await wc.executeJavaScript(`document.getElementById('exportPath').textContent`));
    P('UITEST PASS');
  } catch (err) {
    P('UITEST FAIL ' + err.message);
  } finally {
    setTimeout(() => app.exit(0), 500);
  }
}

// ---------------- 启动 ----------------
app.whenReady().then(() => {
  fs.mkdirSync(resultsDir(), { recursive: true });
  fs.mkdirSync(tasksDir(), { recursive: true });
  require('./engine/default-tasks').installDefaultTasks(require('./engine/storage'));
  registerIpc();
  if (process.argv.includes('--autotest')) {
    runAutotest();
  } else if (process.argv.includes('--uitest')) {
    runUiTest();
  } else {
    createWindow();
  }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

let backupClosing=false;
app.on('before-quit',event=>{if(resultJournal&&!backupClosing){event.preventDefault();backupClosing=true;resultJournal.close().catch(error=>log('备份关闭失败：'+error.message)).finally(()=>app.quit());}});
app.on('window-all-closed', () => { app.quit(); });

