let settingsDirty=false;
function markSettingsDirty(){settingsDirty=true;syncSaveState();}
function syncSaveState(){$('btnSaveRule').disabled=settingsDirty||scraping||detecting;}
'use strict';
// 控制面板逻辑（八爪鱼式布局：顶部工具栏 / 右侧工作流面板 / 底部数据预览）
const $ = id => document.getElementById(id);
const api = window.v6api;
setupNodeOptions();

$('btnWindowMinimize').onclick = () => cmd('window-minimize');
$('btnWindowMaximize').onclick = () => cmd('window-maximize');
$('btnWindowClose').onclick = () => cmd('window-close');

let cfg = { list: null, fields: [], nextSel: null };   // 当前任务配置
let candidates = [];                                    // 识别候选
let picks = [];                                         // 点选记录
let highlightOn = false;
let picking = false;
let scraping = false;
let recognitionDraft=null;
let guidePick=null;
let candidateIndex=0,recognitionMore=false,recognitionMoreSelector="";
function syncRecognitionGuide(){
  if(!recognitionDraft)return;
  const c=candidates[candidateIndex];if(!c)return;
  return cmd('guide',{phase:'review',index:candidateIndex,total:candidates.length,count:c.count,fields:cfg.fields.length,more:recognitionMore});
}
$('btnGuide').onclick=()=>{if(scraping||detecting)return;if(recognitionDraft)syncRecognitionGuide();else cmd('guide',{phase:cfg.list&&Workflow.hasExtract(ensureFlow())?'continue':'idle'});};

// ---------- 通用 ----------
function log(msg) {
  const el = $('log');
  const div = document.createElement('div');
  div.textContent = msg;
  el.appendChild(div);
  while(el.childElementCount>500)el.firstElementChild.remove();
  el.scrollTop = el.scrollHeight;
}

let noticeTimer;
function toast(msg) {
  if (/出错|失败|无效|超时/.test(msg)) { showMessage(msg); return; }
  log('» ' + msg);
  $('notice').textContent = msg;
  $('notice').hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000);
}

async function cmd(name, payload) {
  const r = await api.invoke(name, payload || {});
  if (r && r.ok === false && r.error) toast('出错：' + r.error);
  return r || {};
}

// ---------- 工作流节点状态 ----------
function wf(id, state, text) {
  const el = $(id);
  if (!el) return;
  el.classList.remove('doing', 'done');
  if (state) el.classList.add(state);
  if (text) {
    const name = el.querySelector('.wf-name');
    el.title = text;
  }
}

// ---------- 字段列表渲染 ----------
function checkedFields() { return cfg.fields.filter(f => f.__on !== false); }

function renderFields() {
  const wrap = $('fieldList');
  wrap.innerHTML = '';
  cfg.fields.forEach((f) => {
    const row = document.createElement('div');
    row.className = 'field-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = f.__on !== false;
    cb.onchange = () => { f.__on = cb.checked; refreshHighlight(); previewPage(); };
    const name = document.createElement('input');
    name.className = 'fname';
    name.value = f.name;
    name.title = '可修改字段名';
    const rename=async value=>{
      const next=value.trim(),old=f.name;
      if(!next||cfg.fields.some(field=>field!==f&&field.name===next)){toast(!next?'字段名称不能为空':'字段名称已存在');name.value=f.name;selector.value=f.name;return;}
      if(next===old)return;
      const result=await cmd('rename-result-field',{index:checkedFields().indexOf(f),oldName:old,name:next});
      if(!result.ok)return;
      f.name=next;name.value=next;if(f.virtualColumn||f.tableColumn)selector.value=next;
      const update=nodes=>nodes.forEach(node=>{for(const trigger of node.params?.triggers||[])for(const group of trigger.groups||[])for(const rule of group)if(rule.field===old)rule.field=next;if(node.children)update(node.children);});update(ensureFlow());
      markSettingsDirty();renderTable(tableRows,tableTotal);
    };
    name.onchange = () => rename(name.value);
    const type = document.createElement('select');
    type.className = 'ftype';
    [['text','文本'],['href','链接'],['img','图片'],['innerHtml','InnerHtml'],['html','OuterHtml'],['value','输入值']].forEach(([value,label]) => type.add(new Option(label,value)));
    type.value = f.type;
    type.onchange = () => { f.type = type.value; previewPage(); };
    const sample = document.createElement('span');
    sample.className = 'fsample';
    sample.textContent = f.sample || '';
    sample.title = f.sample || '';
    const selector = document.createElement('input');
    selector.className = 'field-selector';
    selector.placeholder = 'CSS 或以 .// 开始的相对 XPath';
    selector.title = '相对于每个列表项的定位；表格列留空保留原列';
    selector.value = f.xpath || f.rel || '';
    if(f.virtualColumn||f.tableColumn){selector.value=f.name;selector.placeholder='输入采集后的表头名称';selector.title='修改输出表头；保留原始列定位';}
    selector.onchange = () => {
      if(f.virtualColumn||f.tableColumn)return rename(selector.value);
      const value = selector.value.trim();
      delete f.xpath; delete f.rel; delete f.__idx;
      if (value) delete f.index;
      if (value.startsWith('.//') || value.startsWith('./')) f.xpath = value;
      else f.rel = value;
      previewPage();
    };
    const remove = document.createElement('button');
    remove.className = 'mini field-remove';
    remove.title = '删除字段';
    remove.setAttribute('aria-label', '删除字段：' + f.name);
    remove.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
    remove.onclick = () => { cfg.fields.splice(cfg.fields.indexOf(f),1); renderFields(); previewPage(); };
    row.append(cb, name, type, remove, selector, sample);
    wrap.appendChild(row);
  });
  $('fieldsEmpty').hidden=cfg.fields.length>0;
}

function applyListSelection(list) {
  // 首次拆分多阶段规则时，先冻结旧步骤字段，防止详情点选覆盖搜索页。
  const freeze=nodes=>nodes.forEach(n=>{if(n.type==='extract'&&!n.params.fields)n.params.fields=structuredClone(cfg.fields);if(n.children)freeze(n.children);});
  freeze(ensureFlow());
  cfg.list = list;
  const findList = nodes => { for(const node of nodes) { if(node.type==='list') return node; const child=node.children&&findList(node.children);if(child)return child; } };
  const current=currentNode();
  const ancestry=(nodes,parents=[])=>{for(const n of nodes){if(n.id===selectedNode)return [...parents,n];const hit=n.children&&ancestry(n.children,[...parents,n]);if(hit)return hit;}};
  let node=(ancestry(cfg.flow)||[]).reverse().find(n=>n.type==='list')||findList(current?.children||[]);
  if(!node&&current&&['click','input','inputGroup','detail','open'].includes(current.type)&&findList(cfg.flow)?.params?.list){
    node=Workflow.node('list');node.children=[Workflow.node('extract')];
    if(current.type==='detail')current.children.push(node);else{const found=Workflow.find(cfg.flow,current.id);found.siblings.splice(found.index+1,0,node);}
  }
  node ||= findList(ensureFlow());
  if(node) {
    node.params ||= {};
    const previous=node.params.list;
    const scrollEnabled=previous?.genericGrid?previous.scanHidden:previous?.virtualGrid;
    if(list&&typeof scrollEnabled==='boolean'){
      list={...list};
      if(list.genericGrid)list.scanHidden=scrollEnabled;else list.virtualGrid=scrollEnabled;
    }
    node.params.list=list;cfg.list=list;
  }
  const extract=node?.children?.find(n=>n.type==='extract')||(current?.type==='extract'?current:null);
  if(extract){extract.params.fields=cfg.fields;selectedNode=extract.id;}
}

function showMessage(message, title = '操作提示') {
  log('» ' + message);
  $('notice').hidden = true;
  $('messageTitle').textContent = title;
  $('messageBody').textContent = message;
  if (!$('messageDialog').open) openPanelDialog('messageDialog');
}
function ensureExtractionFlow(single=false) {
  const nodes=ensureFlow();
  const hasExtract=items=>items.some(node=>node.type==='extract'||node.children&&hasExtract(node.children));
  if(hasExtract(nodes))return;
  if(nodes.every(node=>node.type==='open')) {
    if(single)nodes.push(Workflow.node('extract'));
    else nodes.push(Workflow.defaults()[1]);
  } else {
    const current=currentNode();
    if(current?.children)current.children.push(Workflow.node('extract'));
    else if(single)nodes.push(Workflow.node('extract'));
    else {const list=Workflow.node('list');list.params.list=cfg.list;list.children=[Workflow.node('extract')];nodes.push(list);}
  }
}
function renderCandidates(){candidateIndex=0;}
function selectCandidate(index){
  const c=candidates[index];if(!c)return;
  candidateIndex=index;
  if(recognitionDraft)cfg.list=c.list;else applyListSelection(c.list);
  cfg.fields=c.fields.map(f=>({...f,__on:true}));
  if(!recognitionDraft&&currentNode()?.type==='extract')currentNode().params.fields=cfg.fields;
  renderFields();refreshHighlight();previewPage();syncRecognitionGuide();
  if(recognitionDraft)cmd('reveal-list',{list:cfg.list});
}

function refreshHighlight() {
  if (!highlightOn) return;
  cmd('highlight', { cfg: { list: cfg.list, fields: checkedFields() }, on: true });
}

// 开/关高亮，并在页面上框选出来（识别、换候选、点选后都会自动框选）
function setHighlight(on) {
  highlightOn = on;
  return cmd('highlight', { cfg: { list: cfg.list, fields: checkedFields() }, on });
}

// ---------- 数据表 ----------
let tableRows=[],tableTotal=0,columnBusy=false;
let previewRenderKey=null,previewRenderFields=[];
let previewFrame=0,pendingPreview=null;
function schedulePreview(sample,total){
  pendingPreview={sample,total};
  if(previewFrame)return;
  previewFrame=requestAnimationFrame(()=>{
    previewFrame=0;const next=pendingPreview;pendingPreview=null;
    renderTable(next.sample,next.total);
  });
}
function lockTableWidths(){
  const table=$('dataTable'),heads=[...table.querySelectorAll('th')];
  if(!heads.length)return;
  const widths=heads.map(th=>th.getBoundingClientRect().width),width=table.getBoundingClientRect().width;
  table.querySelector('colgroup')?.remove();const group=document.createElement('colgroup');
  widths.forEach(w=>{const col=document.createElement('col');col.style.width=w+'px';group.append(col);});table.prepend(group);
  table.style.tableLayout='fixed';table.style.width=width+'px';
}
async function changeColumns(order){
  if(scraping||detecting||columnBusy)return;
  const fields=checkedFields();if(!order.length){toast('至少保留一列');return;}
  columnBusy=true;previewVersion++;
  try{
    const result=await cmd('transform-result-columns',{order,expected:fields});if(!result.ok)return;
    const visible=new Set(fields),remaining=order.map(i=>fields[i]);
    cfg.fields.splice(0,cfg.fields.length,...remaining,...cfg.fields.filter(f=>!visible.has(f)));
    tableRows=tableRows.map(row=>order.map(i=>row[i]));
    renderFields();renderTable(tableRows,tableTotal);refreshHighlight();toast('列已更新，保存规则后保留');
  }finally{columnBusy=false;}
}
function columnMenu(event,index){
  event.preventDefault();if(scraping||detecting||columnBusy)return;
  document.getElementById('columnMenu')?.remove();
  const menu=document.createElement('div');menu.id='columnMenu';menu.className='node-context';menu.setAttribute('role','menu');
  const button=document.createElement('button');button.textContent='删除列';button.setAttribute('role','menuitem');button.disabled=checkedFields().length<2;
  button.onclick=()=>{menu.remove();changeColumns(checkedFields().map((_,i)=>i).filter(i=>i!==index));};menu.append(button);document.body.append(menu);
  const bounds=$('preview').getBoundingClientRect();menu.style.left=Math.max(0,Math.min(event.clientX,innerWidth-menu.offsetWidth-8))+'px';menu.style.top=Math.max(bounds.top,Math.min(event.clientY,innerHeight-menu.offsetHeight-8))+'px';button.focus();
}
document.addEventListener('click',event=>{const menu=$('columnMenu');if(menu&&!menu.contains(event.target))menu.remove();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')$('columnMenu')?.remove();});
function renderTable(sample, total) {
  if(previewFrame){cancelAnimationFrame(previewFrame);previewFrame=0;pendingPreview=null;}
  sample=(sample||[]).slice(0,100);
  const fields=checkedFields();
  const key=JSON.stringify([sample,fields.map(f=>f.name),scraping,detecting]);
  const unchanged=key===previewRenderKey&&fields.length===previewRenderFields.length&&fields.every((field,index)=>field===previewRenderFields[index]);
  tableTotal=total;$('rowCount').textContent='共'+total+'条数据';
  if(unchanged)return;
  previewRenderKey=key;previewRenderFields=fields;
  tableRows=sample.map(row=>row.slice());
  const table = $('dataTable');
  table.querySelector('colgroup')?.remove();table.style.tableLayout='';table.style.width='';
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';
  $('previewEmpty').classList.toggle('hidden', !!(sample && sample.length));
  const headers = !sample.length || fields.length === sample[0].length ? fields.map(f => f.name) : sample[0].map((_, i) => '字段' + (i + 1));
  const trh = document.createElement('tr');
  headers.forEach((h,index) => {
    const th = document.createElement('th');
    th.textContent = h;
    th.title='双击修改字段名称';
    th.ondblclick=()=>editHeader(th,fields[index],index);
    th.title='双击改名 · 拖动排序 · 右键删除';th.draggable=!scraping&&!detecting;
    th.oncontextmenu=event=>columnMenu(event,index);
    th.ondragstart=event=>{if(th.querySelector('input')||scraping||detecting){event.preventDefault();return;}event.dataTransfer.setData('application/x-v6-column',String(index));event.dataTransfer.effectAllowed='move';};
    th.ondragover=event=>{if(!scraping&&!detecting&&Array.from(event.dataTransfer.types).includes('application/x-v6-column')){event.preventDefault();th.classList.add('column-drop');}};
    th.ondragleave=()=>th.classList.remove('column-drop');
    th.ondrop=event=>{event.preventDefault();th.classList.remove('column-drop');const value=event.dataTransfer.getData('application/x-v6-column');if(value==='')return;const from=Number(value),order=fields.map((_,i)=>i);if(!Number.isInteger(from)||from<0||from>=order.length||from===index)return;order.splice(index,0,order.splice(from,1)[0]);changeColumns(order);};
    trh.appendChild(th);
  });
  thead.appendChild(trh);
  sample.slice(0, 100).forEach(row => {
    const tr = document.createElement('tr');
    row.forEach(v => {
      const td = document.createElement('td');
      if (/^https?:\/\//.test(v)) {
        const a = document.createElement('a');
        a.href = v;
        a.textContent = v.length > 60 ? v.slice(0, 60) + '…' : v;
        a.onclick = e => e.preventDefault();
        td.appendChild(a);
        td.title = v;
      } else {
        td.textContent = v;
        td.title = v;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

// ---------- 识别 ----------
let detecting = false;
async function detectPage(){
  if (detecting) { await cmd('detect-stop'); return; }
  if(scraping) return;
  if(recognitionDraft){toast('请先生成或取消当前识别结果');return;}
  const originalCfg=structuredClone(cfg);
  if(picking) await setPicking(false);
  detecting = true;
  const controls = Array.from(document.querySelectorAll('#sidebar button, #sidebar input, #sidebar select, #sidebar textarea, #topbar button, #urlInput')).filter(el=>!el.closest('.window-controls'));
  const states = controls.map(el=>el.disabled);
  controls.forEach(el=>el.disabled=true);
  toast('正在全局滚动，加载页面内容…');
  wf('wfDetect', 'doing', '自动识别中…');
  let r;
  try { r = await cmd('detect'); }
  finally { detecting=false; controls.forEach((el,index)=>el.disabled=states[index]); }
  if (!r.ok || !r.data) { wf('wfDetect', '', '自动识别'); if(r.cancelled) toast('已停止识别');cmd('guide',{phase:'idle',message:r.cancelled?'已取消自动识别':r.error||'识别失败，请重试'}); return; }
  candidates = r.data.candidates || [];
  if (!candidates.length) {
    wf('wfDetect', '', '自动识别');
    toast('没有识别到数据列表，试试「元素选择」');cmd('guide',{phase:'idle',message:'没有识别到列表，请手动选择网页内容。'});
    return;
  }
  renderCandidates();
  const best = candidates[0];
  recognitionDraft=originalCfg;
  cfg.list=best.list;
  cfg.fields = best.fields.map(f => Object.assign({ __on: true }, f));
  candidateIndex=0;
  renderFields();
  wf('wfDetect', 'done', '自动识别 · ' + best.count + '项' + best.fields.length + '字段');
  toast(`${r.scan?.limited ? '已达滚动时间上限，页面可能尚未加载完。' : '滚动加载完成。'}识别到 ${best.count} 项，已框选并预览`);
  // 与八爪鱼一致：识别完成立刻在页面上框选出来，便于判断
  setHighlight(true);
  recognitionMore=!!r.data.loadMore;
  recognitionMoreSelector=r.data.loadMore?.selector||'';
  syncRecognitionGuide();
  previewPage();
};
function generateRule(){
  if(!recognitionDraft)return;
  if(recognitionMore&&!recognitionMoreSelector.trim()){handleGuideAction('modify-more');return;}
  rememberFlow();
  ensureExtractionFlow();applyListSelection(cfg.list);
  if(recognitionMore){
    installGuideLoop('loadMore',recognitionMoreSelector.trim());
  }
  recognitionDraft=null;selectNode('extract');toast('已生成采集设置');cmd('guide',{phase:'continue'});
};
function cancelRecognition(){if(!recognitionDraft)return;cfg=recognitionDraft;recognitionDraft=null;renderFields();renderFlow();setHighlight(false);renderTable([],0);cmd('guide',null);};
function nextRecognition(){if(candidates.length)selectCandidate((candidateIndex+1)%candidates.length);}

// ---------- 点选微调 ----------
async function applyPickRole(idx, role, selectionList) {
  const p = picks[idx];
  if(role==='table-all'){await selectWholeTable(p.path);return;}
  if(role==='action-next'){
    if(!cfg.list){toast('请先选择需要采集的数据列表');return;}
    installGuideLoop('pages',p.path);
    const result=await cmd('run-picked-action',{type:'click',selector:p.path});
    if(result.ok){await previewPage();toast('已生成循环翻页并执行一次，继续选择当前页元素');}
    else toast('循环翻页已保存，本次翻页失败：'+result.error);
    return;
  }
  if(role.startsWith('action-')) {
    rememberFlow();
    const action=role.slice(7), node=Workflow.node(action==='hover'?'hover':'click');
    node.params={selector:p.xpath||p.path,mode:p.xpath?'xpath':'css',relative:false};
    let added=node;
    if(action==='loop') {
      const listNode=Workflow.node('list');
      listNode.params.list=selectionList||{type:'css',selector:p.path};
      node.params={selector:':scope',relative:true,mode:'css'};
      listNode.children=[node];added=listNode;
    }
    const found=Workflow.find(ensureFlow(),selectedNode);
    if(found)found.siblings.splice(found.index+1,0,added);else cfg.flow.push(added);
    selectNode(added.id);
    if(action!=='loop') {
      const result=await cmd('run-picked-action',{type:node.type,selector:p.path});
      if(!result.ok){toast('步骤已生成，本次执行失败：'+(result.error||'页面已变化'));return;}
    }
    toast(action==='loop'?'已生成循环点击步骤':'已生成并执行'+node.name);
    return;
  }
  const pickNodeId=selectedNode;
  if(settingsDirty)captureNodeDraft();
  const r = await cmd('resolve-pick', { path: p.path, role, selectionList, cfg: { list: cfg.list, fields: cfg.fields, nextSel: cfg.nextSel } });
  if(selectedNode!==pickNodeId)return;
  if (r.ok === false) { toast('点选失败：' + r.error); return; }
  const data = r.data || {};
  let pickedNextId;
  if (role === 'list' || role === 'children' || role.startsWith('extract-')) {
    ensureExtractionFlow(role.startsWith('extract-')&&!selectionList);
    applyListSelection(data.list);
    cfg.fields = (data.fields || []).map(f => Object.assign({ __on: true }, f));
    if(currentNode()?.type==='extract')currentNode().params.fields=cfg.fields;
    wf('wfDetect', 'done', '自动识别 · 点选' + data.count + '项');
    toast(`已设为列表项：${data.count} 条，自动提取 ${cfg.fields.length} 个字段`);
  } else if (role === 'field') {
    cfg.list = cfg.list || null;
    cfg.fields = (data.fields || cfg.fields).map(f => Object.assign({ __on: true }, f));
    if(currentNode()?.type==='extract')currentNode().params.fields=cfg.fields;
    toast('已添加字段：' + (data.field && data.field.name));
  } else if (role === 'next') {
    const current=currentNode(),loop=(nodeAncestors(selectedNode)||[]).findLast(n=>n.type==='pages');
    const findNext=nodes=>{for(const node of nodes){if(node.type==='next')return node;if(node.type!=='pages'&&node.children){const hit=findNext(node.children);if(hit)return hit;}}};
    const target=current?.type==='next'?current:findNext(loop?loop.children:ensureFlow());
    if(target){const rule=typeof data.nextSel==='string'?{selector:data.nextSel,type:'css'}:data.nextSel;setNextRule(target,rule.selector,rule.type);pickedNextId=target.id;}
    else cfg.nextSel = data.nextSel;
    toast('已设为下一页按钮');
  }
  p.role = role;
  p.applied = true;
  renderFields();
  // 点选调整后立即在页面框选出来
  setHighlight(true);
  captureNodeDraft=()=>{};markSettingsDirty();
  selectNode(role === 'next' ? pickedNextId||'next' : currentNode()?.type==='extract'?selectedNode:'extract');
  previewPage();
}

function renderMode() {
  $('btnPick').classList.toggle('active', picking);
  $('btnPick').setAttribute('aria-pressed', String(picking));
  $('btnBrowse').classList.toggle('active', !picking);
  $('btnBrowse').setAttribute('aria-pressed', String(!picking));
}
async function setPicking(on) {
  const result = await cmd('pick', { on });
  if (!result.ok) return;
  picking = on;
  renderMode();
  if (picking) toast('选择网页元素；按 Esc 或点击「浏览模式」退出');
}
$('btnPick').onclick = () => setPicking(!picking);
$('btnBrowse').onclick = () => setPicking(false);

$('btnClearNext').onclick = () => {
  if(scraping||detecting||currentNode()?.type!=='next')return;
  $('nextSelector').value='';markSettingsDirty();
};

// ---------- 采集 ----------
function setStartBtn(running) {
  const changed=scraping!==running;
  scraping = running;
  const bs = $('btnStart');
  bs.disabled = false;
  bs.classList.toggle('running', running);
  $('startLabel').textContent = running ? '停止采集' : '采集';
  bs.title=$('startLabel').textContent;

  $('btnSidebarStop').hidden = !running;
  if(!changed)return;
  document.querySelectorAll('#nodeSettings input, #nodeSettings select, #nodeSettings textarea, #nodeSettings button, .side-scroll input, .side-scroll textarea, .side-scroll select, .side-scroll button, .retry-config-dialog input, .retry-config-dialog textarea, #uaApply, #proxyApply, #btnSaveRule, #btnBack, #btnFwd, #btnReload, #btnPick, .flow-actions button, .flow-actions select, .task-manager button, .task-manager input, .task-identity input').forEach(el => { el.disabled = running && !el.matches('.task-entry, #taskExportPng, #taskSearch, .task-group-tab'); });
  if(!running&&currentNode()?.type==='open')$('btnNodeOpen').disabled=!!$('openOptions').querySelector('[data-param=useLoopUrl]')?.checked;
  document.querySelectorAll('.flow-node').forEach(el => { el.draggable = !running; });
  $('btnBrowse').disabled = running;
  $('btnTasksClose').disabled=false;syncSaveState();
}

async function startScrape(allowNoExtract=false) {
  if (scraping || detecting) return;
  if(settingsDirty){toast('请先应用当前配置，再开始采集');return;}
  if(recognitionDraft){toast('请先点击「生成采集设置」');return;}
  const hasExtract=Workflow.hasExtract(ensureFlow());
  allowNoExtract=!hasExtract;
  if (hasExtract && !cfg.list) { showMessage('请先「自动识别」或点选列表项'); return; }
  const fields = checkedFields();
  if (hasExtract && !fields.length) { showMessage('请至少勾选一个字段'); return; }
  const opts = readOptions();
  if (!opts) return;
  if (picking) await setPicking(false);
  setStartBtn(true);
  wf('wfScrape', 'doing', '滚动采集中…');
  $('progress').classList.remove('hidden');
  $('progressFill').style.width = '5%';
  $('progressText').textContent = '启动采集…';
  const result = await cmd('scrape-start', { ...cfg, allowNoExtract:allowNoExtract===true, flow: ensureFlow(), list: cfg.list, fields, nextSel: cfg.nextSel, opts, url: cfg.url || $('urlInput').value, name: $('taskName').value, group: $('taskGroup').value });
  if (!result.ok) { setStartBtn(false); $('progress').classList.add('hidden'); showMessage(result.error || '启动失败','采集启动失败'); }
  if(result.ok){resultRunId=null;resultPage=0;resultTab='data';await drawRunResults();if(!$('resultsDialog').open)await openPanelDialog('resultsDialog');scheduleRunResults();}
}

$('btnStart').onclick = ()=>scraping?stopScrape():startScrape();

async function stopScrape() {
  await cmd('scrape-stop');
  toast('正在停止…');
};

$('btnSidebarStop').onclick=stopScrape;
function scrapeUI(p) {
  if(p.phase==='scroll')$('progressText').textContent=`滚动第 ${p.round} 轮 · 当前页 ${p.rows} 条 · ${p.atEnd?'已到底，等待内容稳定':'继续滚动'} · ${p.seconds} 秒`;
  if (p.phase === 'next') {
    document.querySelector('[data-node=next]')?.classList.add('doing');
    $('progressText').textContent = `第 ${p.page} 页完成，正在翻页…`;
  } else {
    document.querySelector('[data-node=next]')?.classList.remove('doing');
  }
  if (p.phase === 'node') {
    document.querySelectorAll('[data-id]').forEach(el => el.classList.toggle('doing', el.dataset.id === p.id));
    $('progressText').textContent = '执行：' + p.name;
  }
  if (p.phase === 'start') $('progressText').textContent = '开始采集…';
  else if (p.phase === 'page') {
    $('progressText').textContent = `第 ${p.page} 页：发现 ${p.items} 项，滚动采集中…`;
    $('progressFill').style.width = Math.min(90, p.page * 12) + '%';
  } else if (p.phase === 'page-done') {
    $('progressText').textContent = `第 ${p.page} 页完成：新增 ${p.added} 条，累计 ${p.total} 条`;
    wf('wfScrape', 'doing', '滚动采集 · 已采 ' + p.total + ' 条');
  } else if (p.phase === 'done') {
    document.querySelectorAll('[data-id]').forEach(el=>el.classList.remove('doing'));
    $('progressText').textContent = '';
    $('progress').classList.add('hidden');
    wf('wfScrape', 'done', '滚动采集 · 完成 ' + p.total + ' 条');
    setStartBtn(false);
    $('btnRunResults').textContent='采集结果';
  } else if (p.phase === 'error') {
    $('progressText').textContent = '';
    $('progress').classList.add('hidden');
    showMessage(p.message || '采集发生错误，请查看任务日志。', '采集出错');
    wf('wfScrape', '', '滚动采集');
    setStartBtn(false);
  }
  if($('resultsDialog').open&&!resultRunId)scheduleRunResults();
}

// ---------- 导出 ----------
async function doExport(format) {
  const r = await cmd('export', { format, fields: checkedFields() });
  if (r.ok) $('exportPath').textContent = r.path;
}
$('btnCsv').onclick = () => doExport('csv');
$('btnJson').onclick = () => doExport('json');
$('btnXlsx').onclick = () => doExport('xlsx');
$('btnOpenResults').onclick = () => cmd('open-results');
$('btnTogglePreview').onclick = async () => {
  const button = $('btnTogglePreview');
  button.disabled = true;
  const collapsed = button.getAttribute('aria-expanded') === 'true';
  // 原生网页与面板同步改变高度，收起后把空间交还给网页。
  try {
    const result = await cmd('preview-collapse', { collapsed });
    if (!result.ok) return;
    $('preview').classList.toggle('collapsed', collapsed);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.title = collapsed ? '展开数据预览' : '收起数据预览';
    button.setAttribute('aria-label',collapsed?'展开数据预览':'收起数据预览');
  } finally {
    button.disabled = false;
  }
};
$('exportPath').onclick = () => { const p = $('exportPath').textContent; if (p) cmd('open-path', { path: p }); };

// ---------- 网址栏 ----------
async function go() {
  if(recognitionDraft){toast('请先生成或取消当前识别结果');return;}
  const url = $('urlInput').value.trim();
  if (!url) return;
  previewVersion++;
  toast('加载 ' + url);
  wf('wfOpen', 'doing', '打开网页中…');
  if (cfg.url && !(await saveCurrentTask(true))) return;
  const newTaskIdentity=cfg.id&&cfg.url==='about:blank'?{id:cfg.id,name:cfg.name,group:cfg.group}:null;
  const r = await cmd('load-url', { url, fresh: !cfg.id||!!newTaskIdentity });
  if (r.ok) {
    cfg = { url, list: null, fields: [], nextSel: null,...newTaskIdentity }; candidates = []; picks = [];
    $('progress').classList.add('hidden');
    $('exportPath').textContent = '';
    renderFields(); renderTable([], 0); restoreOptions({});
    wf('wfOpen', 'done', '打开网页');
    wf('wfDetect', '', '自动识别');
    wf('wfScrape', '', '滚动采集');
  }
  if (r.ok && r.restored && r.cfg) {
    cfg = Object.assign({ nextSel: null }, r.cfg);
    cfg.fields = (cfg.fields || []).map(f => Object.assign({ __on: true }, f));
    candidates = [{ label: '已保存规则 · ' + cfg.fields.length + '字段', list: cfg.list, fields: cfg.fields }];
    renderCandidates();
    candidateIndex=0;
    renderFields();
    restoreOptions(cfg.opts || {});
    toast('已载入该站点保存的规则，已在页面框选，可直接采集');
    // 已保存的规则同样自动框选出来便于判断
    setHighlight(true);
    previewPage();
  }
  $('taskName').value=cfg.name || ''; $('taskGroup').value=cfg.group || '';
  flowUndo.length=0; selectNode('open');
  if(r.ok)await setPicking(true);
  refreshTasks();
}

$('urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
$('btnBack').onclick = () => cmd('nav-back');
$('btnFwd').onclick = () => cmd('nav-fwd');
$('btnReload').onclick = () => cmd('reload');
$('btnClearLog').onclick = () => { $('log').innerHTML = ''; };

$('btnSaveRule').onclick = async () => {
  const button=$('btnSaveRule');button.disabled=true;
  try{await saveCurrentTask();}
  catch(error){toast('保存失败：'+error.message);}
  finally{syncSaveState();}
};

// ---------- 选项卡 ----------
document.querySelectorAll('.tab').forEach(t => {
  t.onclick = () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    $('tab-basic').classList.toggle('hidden', t.dataset.tab !== 'basic');
    $('tab-retry').classList.toggle('hidden', t.dataset.tab !== 'retry');
    $('tab-adv').classList.toggle('hidden', t.dataset.tab !== 'adv');
  };
});

window.addEventListener('keydown', e => {
  if (e.code === 'F12') { e.preventDefault(); cmd('devtools'); }
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyI') cmd('page-devtools');
});

// ---------- 主进程事件 ----------
api.onEvent(async evt => {
  if(evt.type==='backup-error'){showMessage('实时备份写入失败：'+evt.payload.message,'备份异常');return;}
  const { type, payload } = evt;
  if(type==='table-controls-repaired'){
    cfg=payload.cfg;captureNodeDraft=()=>{};settingsDirty=false;
    selectNode(selectedNode);renderFields();
    toast('已移除旧流程误识别的控制列：'+payload.removed.join('、'));return;
  }
  if(type==='task-load-error'&&payload.id===cfg.id)toast(payload.message);
  if (type === 'window-state') {
    const button = $('btnWindowMaximize');
    button.classList.toggle('maximized', payload.maximized);
    button.title = payload.maximized ? '还原' : '最大化';
    button.setAttribute('aria-label', button.title);
  } else if (type === 'nav') {
    if (document.activeElement !== $('urlInput')) $('urlInput').value = payload.url || '';
    document.title = (payload.title || '采集助手 V6');
    if (payload.loading) {
      wf('wfOpen', 'doing', '打开网页中…');
      // 页面跳转后注入的高亮/点选已失效，复位按钮状态（识别后会重新框选）
      highlightOn = false;
              renderMode();
    } else {
      wf('wfOpen', 'done', '打开网页');
    }
  } else if (type === 'pick-mode') {
    picking=payload.on;renderMode();
  } else if (type === 'record-input') {
    rememberFlow();const node=Workflow.node(payload.entries.length>1?'inputGroup':'input');
    node.params=payload.entries.length>1?payload:{...payload.entries[0],enter:payload.enter};
    insertRecordedNode(node);
    const result=await cmd('run-input',payload);toast(result.ok?'已生成步骤并执行输入':'步骤已保留，执行失败：'+result.error);
  } else if (type === 'record-captcha') {
    rememberFlow();const node=Workflow.node('captcha');node.params={...payload,timeout:120};insertRecordedNode(node);toast('已添加人工处理验证码步骤');
  } else if (type === 'log') {
    log(payload.msg);
  } else if (type === 'detect-progress') {
    if(detecting) cmd('guide',{phase:'progress',message:`已滚动 ${payload.rounds} 轮 · ${payload.seconds} 秒 · ${payload.regions} 个滚动区域`});
  } else if (type === 'pick') {
    if(nodeOptionPick){await acceptNodeOptionPick(payload);return;}
    if(guidePick){completeGuidePick(payload);return;}
    picks = [Object.assign({ role: null }, payload)];
    document.querySelector('[data-tab=basic]').click();
  } else if (type === 'pick-action') {
    let index=picks.findLastIndex(item=>item.path===payload.path);
    if(index<0) {picks.push({...payload,role:null});index=picks.length-1;}
    applyPickRole(index,payload.role,payload.selectionList);
  } else if (type === 'pick-off') {
    if(guidePick){guidePick=null;if(recognitionDraft)syncRecognitionGuide();else cmd('guide',{phase:'continue'});}
    picking = false;
    renderMode();
  } else if (type === 'scrape') {
    scrapeUI(payload);
  } else if (type === 'rows') {
    schedulePreview(payload.sample, payload.total);
  } else if (type === 'export') {
    $('exportPath').textContent = payload.path;
  } else if(type==='guide'){
    handleGuideAction(payload.action);
  } else if (type === 'optip') {
    // 页面里「操作提示」浮窗的按钮
    if (payload.action === 'detect') detectPage();
    else if (payload.action === 'login') toast('请在右侧浏览器中直接登录网站，完成后重新「自动识别」');
  }
});

log('就绪。输入网址后可识别字段或编辑流程。');

let selectedNode = null;
let nodeClipboard = null;
const flowUndo = [];
let boundRuleConfig=null;
const nodeDefaults = Workflow.labels;
function ensureFlow() { cfg.flow ||= cfg.list ? Workflow.defaults(cfg.nodeNames) : [Workflow.node('open')]; return cfg.flow; }
function insertRecordedNode(node){const found=Workflow.find(ensureFlow(),selectedNode);if(found)found.siblings.splice(found.index+1,0,node);else cfg.flow.push(node);selectNode(node.id);}
function rememberFlow() { flowUndo.push(structuredClone(ensureFlow())); if (flowUndo.length > 30) flowUndo.shift(); }
function currentNode() { return Workflow.find(ensureFlow(), selectedNode)?.node; }
function nodeAncestors(id,nodes=ensureFlow(),parents=[]) {
  for(const node of nodes){const path=[...parents,node];if(node.id===id)return path;const hit=node.children&&nodeAncestors(id,node.children,path);if(hit)return hit;}
}
function bindLegacyNodeRules() {
  if(boundRuleConfig===cfg)return;boundRuleConfig=cfg;
  // 旧任务的全局规则只迁入节点一次，避免随后切换编辑上下文时串用配置。
  const list=cfg.list,fields=cfg.fields||[],next=typeof cfg.nextSel==='string'?{type:'css',selector:cfg.nextSel}:cfg.nextSel;
  const walk=(nodes,inList=false,scopeList=list)=>nodes.forEach(node=>{
    const p=node.params||={};
    if(node.type==='list'&&!p.list&&scopeList)p.list=structuredClone(scopeList);
    if(node.type==='extract'){
      p.fields??=structuredClone(fields);
      if(!inList&&!p.list&&scopeList)p.list=structuredClone(scopeList);
    }
    if(node.type==='next'&&!Object.hasOwn(p,'selector')&&next)Object.assign(p,{selector:next.selector,mode:next.type||'css'});
    if(node.children)walk(node.children,inList||node.type==='list',p.list||scopeList);
  });walk(ensureFlow());
}
function syncNodeContext(node) {
  const path=nodeAncestors(node.id)||[],listNode=path.findLast(n=>n.type==='list');
  if(!listNode&&node.type!=='extract')return;
  const extract=node.type==='extract'?node:listNode.children?.find(n=>n.type==='extract');
  if(extract)extract.params.fields??=[];
  const list=path.findLast(n=>n.params?.list)?.params.list||null,fields=extract?.params.fields||[];
  if(cfg.list===list&&cfg.fields===fields)return;
  cfg.list=list;cfg.fields=fields;
  previewVersion++;renderFields();renderTable([],0);
}
function nextRuleContext(node) {
  const loop=(nodeAncestors(node.id)||[]).findLast(n=>n.type==='pages');
  const p=node.params||{},legacy=typeof cfg.nextSel==='string'?{selector:cfg.nextSel,type:'css'}:cfg.nextSel;
  if(loop?.params.selector)return {loop,selector:loop.params.selector,mode:Workflow.selectorMode(loop.params)};
  return {loop,selector:p.selector??legacy?.selector??'',mode:p.mode||legacy?.type||'xpath'};
}
function setNextRule(node,selector,mode) {
  const {loop}=nextRuleContext(node);
  Object.assign(node.params,{selector,mode});
  if(loop?.params.selector)Object.assign(loop.params,{selector,mode});
}
function validateNodeSelector(mode,selector,label) {
  if(!selector)return true;
  try{if(mode==='xpath')document.createExpression(selector,null);else document.querySelector(selector);return true;}
  catch{toast(label+' '+(mode==='xpath'?'XPath':'CSS')+' 语法无效');return false;}
}
function updateSelectorLabels() {
  for(const name of ['list','next']){
    const mode=$(name+'Mode').value,caption=name==='list'?'列表':'下一页';
    $(name+'SelectorLabel').textContent=caption+' '+(mode==='auto'?'定位':mode==='css'?'CSS':'XPath');
    $(name+'Selector').placeholder=name==='next'?'留空自动识别':mode==='auto'?'选择自动识别后点击应用':mode==='css'?'例如 .product-list > .item':'未设置 XPath';
  }
}
function renderTaskLabel(){
  const label=$('flowTaskLabel');
  const text=cfg.name?(cfg.group||'未分组')+'-'+cfg.name:'';
  label.textContent=text;label.title=text;
}
function renderFlow() {
  renderTaskLabel();
  $('nodeContext').hidden=true;
  const toolbar=document.querySelector('.flow-toolbar');
  const wrap = $('flowTree'); wrap.replaceChildren();
  const heading=document.createElement('div');heading.className='flow-heading';heading.append(toolbar);
  const start=document.createElement('div');start.className='flow-terminal';start.textContent='▷';start.title='开始';heading.append(start);wrap.append(heading);
  const assigned = new Set();
  function draw(nodes, parent, ownerId=null) {
    const insertPoint=index=>{
      const connector=document.createElement('div');connector.className='flow-connector';
      const add=document.createElement('button');add.className='flow-insert';add.textContent='+';add.title='插入流程节点';add.setAttribute('aria-label','插入流程节点');add.dataset.owner=ownerId||'';add.dataset.index=index;add.disabled=scraping||detecting;
      add.onclick=event=>{event.stopPropagation();showInsertMenu(add,ownerId,index);};connector.append(add);parent.append(connector);
    };
    insertPoint(0);
    nodes.forEach((node,index) => {
      const group = document.createElement('div'); group.className = node.children ? 'flow-loop' : 'flow-item';
      const button = document.createElement('button'); button.className = 'flow-node';
      button.dataset.node = node.type; button.dataset.id = node.id; button.textContent = node.name;
      button.classList.toggle('selected', node.id === selectedNode);
      button.classList.toggle('node-disabled', node.enabled === false);
      button.setAttribute('aria-pressed', String(node.id === selectedNode));
      const legacyId = {open:'wfOpen',list:'wfDetect',extract:'wfScrape'}[node.type];
      if (legacyId && !assigned.has(legacyId)) { button.id = legacyId; assigned.add(legacyId); }
      button.draggable = !scraping;
      button.onclick = () => selectNode(node.id);
      button.oncontextmenu = event => {event.preventDefault();selectNode(node.id);showNodeMenu(event);};
      button.ondragstart = event => { event.dataTransfer.setData('text/plain', node.id); };
      button.ondragover = event => { if (!scraping) { event.preventDefault(); button.classList.add('drop-target'); } };
      button.ondragleave = () => button.classList.remove('drop-target');
      button.ondrop = event => {
        event.preventDefault(); button.classList.remove('drop-target');
        if (scraping) return;
        rememberFlow();
        if (!Workflow.move(cfg.flow, event.dataTransfer.getData('text/plain'), node.id, event.shiftKey)) flowUndo.pop();
        renderFlow();
      };
      button.title = node.name + '\n拖到此处排在此节点前；按住 Shift 拖入循环';
      group.append(button);
      const more=document.createElement('button');more.className='flow-more';more.textContent='⋯';more.title='节点操作';more.setAttribute('aria-label',node.name+'操作菜单');more.onclick=event=>{event.stopPropagation();selectNode(node.id);showNodeMenu(event);};group.append(more);
      if (node.children) {
        const fold=document.createElement('button');fold.type='button';fold.className='mini fold-node';
        fold.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>';
        fold.title=node.collapsed?'展开子步骤':'收起子步骤';fold.setAttribute('aria-label',fold.title);fold.setAttribute('aria-expanded',String(!node.collapsed));
        fold.onclick=()=>{node.collapsed=!node.collapsed;renderFlow();};group.prepend(fold);
        if(!node.collapsed){const content=document.createElement('div');content.className='flow-children';draw(node.children,content,node.id);if(!node.children.length){const empty=document.createElement('div');empty.className='flow-empty';empty.textContent='点击 + 添加步骤';content.append(empty);}group.append(content);}
      }
      parent.append(group);
      insertPoint(index+1);
    });
  }
  draw(ensureFlow(), wrap);
  const end=document.createElement('div');end.className='flow-terminal flow-end';end.textContent='□';end.title='结束';wrap.append(end);
  if (!cfg.flow.length) { const hint=document.createElement('p'); hint.textContent='请选择节点类型并添加'; wrap.append(hint); }
}
function selectNode(id) {
  if(settingsDirty)captureNodeDraft();
  ensureFlow();
  let found = Workflow.find(cfg.flow, id);
  if (!found) {
    const findType = nodes => { for (const n of nodes) { if(n.type === id) return n; const hit = n.children && findType(n.children); if(hit) return hit; } };
    const node = findType(cfg.flow); if (node) found = { node };
  }
  const node = found?.node || cfg.flow[0];
  selectedNode = node?.id || null;
  renderFlow();
  $('nodeSettings').hidden = !node;
  if (!node) return;
  const type = node.type, params = node.params ||= {};
  bindLegacyNodeRules();syncNodeContext(node);
  $('nodeSettings').closest('.side-scroll').scrollTop = 0;
  $('nodeName').value = node.name;
  $('nodeEnabled').checked = node.enabled !== false;
  document.querySelectorAll('[data-settings]').forEach(el => { el.hidden = el.dataset.settings !== type; });
  $('nodeUrl').value = params.url || cfg.url || $('urlInput').value;
  const list = params.list || cfg.list;
  $('listMode').value = ['css','xpath'].includes(list?.type) ? list.type : 'xpath';
  $('listSelector').value = list?.selector || '';
  $('listVirtualGrid').checked = list?.genericGrid?list.scanHidden!==false:!!list?.virtualGrid;
  $('listVirtualGrid').closest('label').hidden=false;
  const next=nextRuleContext(node);
  $('nextMode').value = next.mode;
  $('nextSelector').value = next.selector;
  $('listCheckStatus').hidden=true;updateSelectorLabels();
  const extra = $('nodeExtra'); extra.replaceChildren();
  if (type === 'detail') {
    const hint = document.createElement('p');
    hint.className = 'detail-hint';
    hint.textContent = '进入链接后执行内部步骤，完成后返回列表。字段按详情页内容定位。';
    extra.append(hint);
  }
  const fields = type === 'wait' ? [['seconds','等待秒数','number',1]] : type === 'scroll' ? [['pixels','向下滚动像素','number',600]] : ['click','hover','detail'].includes(type) ? [['selector','元素选择器','text',''],['mode','定位方式','select','css'],['relative','相对于循环项','checkbox',type === 'detail']] : [];
  if(['repeat','scrollLoop','loadMore'].includes(type))fields.push(['count','循环次数','number',100],['seconds','间隔秒数','number',1]);
  if(['input','inputGroup'].includes(type))fields.push(['enter','输入后按回车 Enter','checkbox',false]);
  if(type==='list')fields.push(['timeout','列表加载超时','number',Number(cfg.opts?.loadTimeoutSec??25)]);
  if(['input','inputGroup'].includes(type)){
    // 旧单输入节点直接作为第一项编辑，增加第二项时才转换为 entries。
    const entries=params.entries||[params];
    entries.forEach((entry,index)=>{
      const section=document.createElement('details');section.className='input-text-item';section.open=true;
      const heading=document.createElement('summary');heading.textContent='文本框'+(index+1);section.append(heading);
      if(entries.length>1){const remove=document.createElement('button');remove.className='input-text-remove';remove.textContent='×';remove.title='删除文本框';remove.onclick=event=>{event.preventDefault();rememberFlow();params.entries.splice(index,1);markSettingsDirty();selectNode(node.id);};heading.append(remove);}
      for(const key of ['value','selector']){const label=document.createElement('label');label.textContent=key==='selector'?'元素 XPath':'输入内容';const input=document.createElement(key==='value'?'textarea':'input');input.value=entry[key]??'';input.placeholder=key==='selector'?'未设置 XPath':'输入文本';input.onchange=()=>{rememberFlow();entry[key]=input.value;if(key==='selector')entry.mode='xpath';markSettingsDirty();};label.append(input);if(key==='selector')attachTargetPicker(input,node,data=>{rememberFlow();entry.selector=data.xpath;entry.mode='xpath';input.value=data.xpath;});section.append(label);}
      const relative=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=!!entry.relative;check.onchange=()=>{rememberFlow();entry.relative=check.checked;markSettingsDirty();};relative.append(check,document.createTextNode('相对于循环项'));section.append(relative);extra.append(section);
    });
    const add=document.createElement('button');add.className='input-text-add';add.textContent='添加文本框';add.onclick=()=>{rememberFlow();params.entries||=[{selector:params.selector||'',mode:params.mode||'xpath',value:params.value??'',relative:!!params.relative}];params.entries.push({selector:'',value:'',mode:'xpath'});markSettingsDirty();selectNode(node.id);};extra.append(add);
  }
  if(type==='captcha'){
    const label=document.createElement('p');label.textContent='运行时等待人工处理，手动完成验证码后点击确认。';extra.append(label);
    const kind=document.createElement('select');[['图片验证码','image'],['滑块拼图','slider'],['点选文字','text']].forEach(([label,value])=>kind.add(new Option(label,value)));kind.value=params.kind||'image';kind.onchange=()=>{rememberFlow();params.kind=kind.value;};const row=document.createElement('label');row.textContent='验证码类型';row.append(kind);extra.append(row);
    fields.push(['selector','验证码元素','text',''],['timeout','等待超时','number',120]);
  }
  if(['scrollLoop','loadMore'].includes(type))fields.push(['stopUnchanged','内容不再更新时结束','checkbox',true]);
  if(type==='scrollLoop')fields.push(['selector','滚动区域（留空为全局）','text',''],['bottom','滚动到底部（关闭则滚动一屏）','checkbox',true]);
  if(['loadMore','condition','select'].includes(type))fields.push(['selector','元素选择器','text',''],['mode','定位方式','select','css']);
  if(type==='condition')fields.push(['operator','判断条件','select','exists'],['value','比较值','text',''],['timeout','等待条件成立','number',0]);
  if(type==='select')fields.push(['value','选项值或文本','text','']);
  if(['click','hover','input','inputGroup','select','open'].includes(type))fields.push(['timeout',type==='open'?'页面加载超时':'等待元素超时','number','']);
  if(NodeRetry.atomicTypes.includes(type))fields.push(['onError','重试耗尽后','select','stop']);
  if(type==='extract')fields.push(['dedupe','自动去重','checkbox',true]);
  if(type==='click')fields.push(['optional','元素未出现时跳过','checkbox',false]);
  fields.forEach(([key,label,inputType,value]) => {
    const row = document.createElement('label'); row.textContent=label;
    const input=document.createElement(inputType==='select'?'select':'input');
    if(inputType==='select') { const choices=key==='operator'?[['存在元素','exists'],['不存在元素','missing'],['包含文本','contains'],['当前网址包含','urlContains'],['当前网址等于','urlEquals']]:key==='onError'?[['停止采集','stop'],['继续下一步','continue']]:[['CSS','css'],['XPath','xpath']];choices.forEach(([label,value])=>input.add(new Option(label,value))); }
    else input.type=inputType;
    input.dataset.param=key;
    if(key==='timeout'&&['click','hover','input','inputGroup','select','open'].includes(type)){input.placeholder=params.optional?'留空：1 秒':'留空：沿用任务加载超时';input.title='元素就绪后立即执行；这里设置的是最长等待时间，0 表示只检查一次';}
    if(key==='mode'&&!params.selector)value='xpath';
    if(inputType==='checkbox') input.checked=params[key] ?? value;
    else input.value=params[key] ?? value;
    if(inputType==='number') {input.min=key==='count'?'1':'0'; input.max=key==='pixels'?'100000':key==='count'?'999':'600'; input.step=key==='seconds'?'0.1':'1';if(['seconds','timeout'].includes(key)){input.removeAttribute('max');input.step='any';}}
    input.disabled=scraping;
    input.onchange=()=>{
      if(!input.checkValidity()) {input.reportValidity(); return;}
      rememberFlow();
      if(inputType==='checkbox') params[key]=input.checked;
      else if(inputType==='number' && input.value==='') delete params[key];
      else params[key]=inputType==='number'?Number(input.value):input.value;
    };
    row.append(input); extra.append(row);
    if(inputType==='number'&&['timeout','seconds'].includes(key))addInputUnit(input,'s');
  });
  if(type==='extract'){
    (params.triggers||[]).forEach((trigger,index)=>{const row=document.createElement('div');row.className='task-actions';const label=document.createElement('span');label.textContent=trigger.name;const remove=document.createElement('button');remove.className='mini';remove.textContent='删除';remove.onclick=()=>{rememberFlow();params.triggers.splice(index,1);selectNode(node.id);};row.append(label,remove);extra.append(row);});
    const add=document.createElement('button');add.className='mini';add.textContent='新增过滤触发器';add.onclick=()=>editTrigger(node);extra.append(add);
  }
  $('nodeSettings').querySelectorAll('input,select,textarea,button').forEach(el=>{el.disabled=scraping;});
  renderNodeOptions(node);
}
$('nodeName').onchange = () => {
  const node=currentNode(); if(!node || scraping) return;
  rememberFlow(); node.name=$('nodeName').value.trim() || nodeDefaults[node.type];
  cfg.nodeNames ||= {}; cfg.nodeNames[node.type]=node.name;
  renderFlow();
};
$('nodeEnabled').onchange=()=>{const node=currentNode();if(node && !scraping){rememberFlow();node.enabled=$('nodeEnabled').checked;renderFlow();}};
$('nodeUrl').onchange=()=>{const node=currentNode();if(node && !scraping){rememberFlow();node.params.url=$('nodeUrl').value.trim();}};
function copyNode(){if(currentNode()){nodeClipboard=structuredClone(currentNode());toast('节点已复制');}};
function pasteNode(){if(!nodeClipboard || scraping)return;rememberFlow();const node=Workflow.copy(nodeClipboard);const found=Workflow.find(cfg.flow,selectedNode);if(found)found.siblings.splice(found.index+1,0,node);else cfg.flow.push(node);selectNode(node.id);};
function deleteNode(){
  const nodes=ensureFlow(),found=Workflow.find(nodes,selectedNode);if(!found||scraping)return;
  const flat=[];function walk(items){for(const n of items){flat.push(n);if(n.children)walk(n.children);}}walk(nodes);
  const previous=flat[flat.findIndex(n=>n.id===selectedNode)-1];
  const scroll=$('flowTree').scrollTop;rememberFlow();found.siblings.splice(found.index,1);markSettingsDirty();
  selectNode(previous?.id||found.siblings[0]?.id);$('flowTree').scrollTop=scroll;
};
function shiftNode(delta) {const found=Workflow.find(ensureFlow(),selectedNode);if(!found || scraping)return;const target=found.index+delta;if(target<0||target>=found.siblings.length)return;rememberFlow();found.siblings.splice(found.index,1);found.siblings.splice(target,0,found.node);renderFlow();}

function undoNode(){if(!scraping && flowUndo.length){cfg.flow=flowUndo.pop();selectNode(selectedNode);}};
$('btnNodeOpen').onclick = () => { if($('btnNodeOpen').disabled)return;$('urlInput').value = $('nodeUrl').value; go(); };
async function applyListSettings() {
  if ($('listMode').value === 'auto') { await detectPage(); return false; }
  const list = { ...currentNode()?.params?.list, type: $('listMode').value, selector: $('listSelector').value.trim() };
  if(list.genericGrid)list.scanHidden=$('listVirtualGrid').checked;else list.virtualGrid=$('listVirtualGrid').checked;
  if (!list.selector) { toast('请输入列表选择器'); return; }
  if(!validateNodeSelector(list.type,list.selector,'列表定位'))return false;
  rememberFlow();
  if (currentNode()?.type === 'list') currentNode().params.list = list;
  cfg.list = list;
  renderFields();
  return true;
}
function applyNextSettings() {
  const selector = $('nextSelector').value.trim();
  if(!validateNodeSelector($('nextMode').value,selector,'下一页定位'))return false;
  rememberFlow();
  if (currentNode()?.type === 'next') setNextRule(currentNode(),selector,$('nextMode').value);
  return true;
}
$('listMode').onchange=()=>{updateSelectorLabels();$('listCheckStatus').hidden=true;};
$('nextMode').onchange=updateSelectorLabels;
$('btnAddField').onclick = () => {
  cfg.fields.push({ name: '字段' + (cfg.fields.length + 1), type: 'text', rel: ':scope', __on: true });
  renderFields(); previewPage();
};
const optionInputs = {
  maxPages: ['optPages',5], maxScrollSec: ['optScrollSec',40], loadTimeoutSec: ['optLoadTimeout',25],
  beforeWaitSec: ['optBeforeWait',0], nextWaitSec: ['optNextWait',1.2], scrollWait: ['optScrollWait',700]
};
function readOptions() {
  const opts = { scrollLoad: $('optScroll').checked, autoNext: $('optNext').checked,fitTable:$('optFitTable').checked };
  for (const [key,[id]] of Object.entries(optionInputs)) {
    if (!$(id).value || !$(id).checkValidity()) { showConfigError($(id)); return null; }
    opts[key] = Number($(id).value);
  }
  return opts;
}
function restoreOptions(opts) {
  $('optFitTable').checked=!!opts.fitTable;
  for (const [key,[id,value]] of Object.entries(optionInputs)) $(id).value = opts[key] ?? value;
  $('optScroll').checked = opts.scrollLoad !== false;
  $('optNext').checked = opts.autoNext !== false;
  document.querySelectorAll('[data-node=pages]').forEach(el => el.classList.toggle('node-disabled', !$('optNext').checked));
}
$('optNext').onchange = () => renderFlow();
let previewVersion = 0;
async function previewPage() {
  if (!cfg.list || scraping) return;
  const version = ++previewVersion;
  // Background previews may run before the workflow reaches its list page.
  // Check freshness before displaying results; explicit Apply still uses cmd.
  const result = await api.invoke('preview-page', { list: cfg.list, fields: checkedFields() });
  if (version !== previewVersion || scraping) return;
  if (result.ok) renderTable(result.data.rows, result.data.count);
}
selectNode('open');

let taskEntries=[],taskOpening=false;
let taskGroups=[],activeTaskGroup=null;
const selectedTaskIds=new Set();
let batchTaskBusy=false;
function visibleTasks(){const search=$('taskSearch').value.toLowerCase();return taskEntries.filter(t=>(activeTaskGroup===null||t.group===activeTaskGroup)&&(t.name+' '+t.group+' '+t.url).toLowerCase().includes(search));}
function updateTaskSelection(){
  const visible=visibleTasks(),count=visible.filter(t=>selectedTaskIds.has(t.id)).length;
  $('taskSelectAll').checked=visible.length>0&&count===visible.length;
  $('taskSelectAll').indeterminate=count>0&&count<visible.length;
  $('taskSelectAll').disabled=batchTaskBusy||scraping||detecting||!visible.length;
  $('taskSelectedCount').textContent='已选 '+selectedTaskIds.size+' 项';
  $('btnBatchDelete').disabled=batchTaskBusy||scraping||detecting||!selectedTaskIds.size;
}
async function refreshTasks() {
  renderTaskLabel();
  if(!$('tasksDialog').open)return;
  const result=await cmd('task-list',{});
  if(result.ok) {taskEntries=result.tasks;taskGroups=result.groups||[];if(typeof renderTaskGroups==='function')renderTaskGroups();const taskIds=new Set(taskEntries.map(task=>task.id));for(const id of selectedTaskIds)if(!taskIds.has(id))selectedTaskIds.delete(id);renderTasks();}
}
function renderTasks() {
  const fragment=document.createDocumentFragment();
  visibleTasks().forEach(task=>{
    const item=document.createElement('div');item.className='task-select-row';
    const check=document.createElement('input');check.type='checkbox';check.checked=selectedTaskIds.has(task.id);check.disabled=scraping||detecting||batchTaskBusy;check.setAttribute('aria-label','选择任务 '+task.name);
    check.onchange=()=>{if(check.checked)selectedTaskIds.add(task.id);else selectedTaskIds.delete(task.id);updateTaskSelection();};
    const row=document.createElement('button');row.className='task-entry';row.disabled=detecting||taskOpening;
    row.classList.toggle('active',task.id===cfg.id);row.textContent=(task.group?task.group+' / ':'')+task.name;
    row.draggable=!scraping&&!batchTaskBusy;row.ondragstart=e=>{e.dataTransfer.setData('application/x-task-id',task.id);e.dataTransfer.effectAllowed='move';};row.oncontextmenu=e=>{e.preventDefault();showTaskContext(task,e);};
    row.title=task.url;row.onclick=async()=>{
      if(taskOpening||scraping||detecting)return;
      taskOpening=true;row.textContent='正在打开…';$('taskList').setAttribute('aria-busy','true');
      $('taskList').querySelectorAll('.task-entry').forEach(button=>button.disabled=true);
      try{
        if(!(await saveCurrentTask(true)))return;
        const result=await cmd('task-open',{id:task.id});if(result.ok){loadEditor(result.cfg);$('tasksDialog').close();}
      }finally{taskOpening=false;$('taskList').removeAttribute('aria-busy');renderTasks();}
    };item.append(check,row);fragment.append(item);
  });
  $('taskList').replaceChildren(fragment);
  updateTaskSelection();
}
async function saveCurrentTask(quiet=false) {
  if(settingsDirty){toast('请先应用配置，再保存任务');return false;}
  if(recognitionDraft){toast('请先生成或取消当前识别结果');return false;}
  const url=cfg.url || $('urlInput').value.trim();
  if(!url || url==='about:blank') {if(!quiet)toast('请输入任务网址');return quiet;}
  const opts=readOptions();if(!opts)return false;
  try{Workflow.validate(ensureFlow());}catch(error){toast(error.message);return false;}
  const result=await cmd('apply-cfg',{...cfg,url,flow:ensureFlow(),opts,name:$('taskName').value.trim()||'未命名任务',group:$('taskGroup').value.trim()});
  if(!result.ok){toast('规则保存失败：'+(result.error||'未收到保存确认'));return false;}
  cfg.id=result.cfg?.id || cfg.id;cfg.url=url;cfg.name=$('taskName').value.trim();cfg.group=$('taskGroup').value.trim();
  if(!quiet)toast('任务已保存');await refreshTasks();return true;
}
function loadEditor(task) {
  recognitionDraft=null;guidePick=null;candidateIndex=0;recognitionMore=false;recognitionMoreSelector='';$('nodeContext').hidden=true;
  previewVersion++; cfg={list:null,fields:[],nextSel:null,...task}; candidates=[];picks=[];flowUndo.length=0;
  $('urlInput').value=cfg.url||'';$('taskName').value=cfg.name||'';$('taskGroup').value=cfg.group||'';
  $('progress').classList.add('hidden');$('exportPath').textContent='';
  renderFields();renderTable([],0);restoreOptions(cfg.opts||{});selectNode('open');
  if(cfg.list){candidates=[{label:'已保存规则',list:cfg.list,fields:cfg.fields}];renderCandidates();}
  refreshTasks();
}
let taskSearchTimer;
$('taskSearch').oninput=()=>{clearTimeout(taskSearchTimer);taskSearchTimer=setTimeout(renderTasks,120);};
$('btnTasks').onclick=async()=>{await openPanelDialog('tasksDialog');await refreshTasks();$('taskSearch').focus();};
$('btnTasksClose').onclick=()=>$('tasksDialog').close();
$('taskSelectAll').onchange=()=>{for(const task of visibleTasks()){$('taskSelectAll').checked?selectedTaskIds.add(task.id):selectedTaskIds.delete(task.id);}renderTasks();};
$('btnBatchDelete').onclick=async()=>{
  if(batchTaskBusy||scraping||detecting||!selectedTaskIds.size)return;
  batchTaskBusy=true;renderTasks();
  try{
    const result=await cmd('task-delete-batch',{ids:[...selectedTaskIds]});
    if(!result.ok){toast(result.error||'删除失败');return;}
    if(result.cancelled)return;
    result.deleted.forEach(id=>selectedTaskIds.delete(id));
    if(result.deleted.includes(cfg.id)){await cmd('task-new');settingsDirty=false;loadEditor({});syncSaveState();}
    toast('已删除 '+result.deleted.length+' 个任务'+(result.failed.length?'，'+result.failed.length+' 个失败，已保留勾选':''));
  }finally{batchTaskBusy=false;await refreshTasks();}
};
let listCheckVersion=0;
async function checkListRule(suggest=false){
  if(scraping||detecting)return;
  const node=currentNode();if(node?.type!=='list')return;
  const list={...node.params.list,type:$('listMode').value,selector:$('listSelector').value.trim()};
  if(list.type==='auto'||!list.selector){toast('请先点选列表，或选择定位方式后填写规则');return;}
  if(!validateNodeSelector(list.type,list.selector,'列表定位'))return;
  if(list.genericGrid)list.scanHidden=$('listVirtualGrid').checked;else list.virtualGrid=$('listVirtualGrid').checked;
  const version=++listCheckVersion;
  const current=()=>version===listCheckVersion&&selectedNode===node.id&&$('listMode').value===list.type&&$('listSelector').value.trim()===list.selector;
  const fields=node.children?.find(n=>n.type==='extract')?.params?.fields||cfg.fields;
  const result=await cmd(suggest?'suggest-list':'preview-page',{list,fields});
  if(!current())return;
  if(!suggest){
    if(!result.ok)return;renderTable(result.data.rows,result.data.count);
    $('listCheckStatus').textContent='匹配 '+result.data.count+' 条；检查当前数据预览后点击底部“应用”。';$('listCheckStatus').hidden=false;
    if($('btnTogglePreview').getAttribute('aria-expanded')==='false')await $('btnTogglePreview').onclick();return;
  }
  if(!result.ok||!result.data?.list){toast('未找到可靠候选，请重新点选一张完整商品卡片');return;}
  const candidate=result.data;
  $('listMode').value='css';$('listSelector').value=candidate.list.selector;
  updateSelectorLabels();markSettingsDirty();
  renderTable(candidate.samples,candidate.count);
  if($('btnTogglePreview').getAttribute('aria-expanded')==='false')await $('btnTogglePreview').onclick();
  $('listCheckStatus').textContent='候选匹配 '+candidate.count+' 条，已展示前3条。确认后点击底部“应用”。';$('listCheckStatus').hidden=false;
}
$('btnInspectList').onclick=()=>checkListRule();
$('btnSuggestList').onclick=()=>checkListRule(true);
$('btnNewTask').onclick=async()=>{if(!(await saveCurrentTask(true)))return;const r=await cmd('task-new');if(r.ok)loadEditor({});};
refreshTasks();
function showNodeMenu(event){
  if(scraping)return;
  const menu=$('nodeContext');menu.replaceChildren();menu.classList.remove('flow-add-menu');
  const found=Workflow.find(ensureFlow(),selectedNode);
  const actions=[['修改名称',()=>{$('nodeName').focus();$('nodeName').select();},!found],['复制',copyNode,!found],['粘贴',pasteNode,!nodeClipboard],['剪切',()=>{copyNode();deleteNode();},!found],['上移',()=>shiftNode(-1),!found||found.index===0],['下移',()=>shiftNode(1),!found||found.index===found.siblings.length-1],['删除',deleteNode,!found],['撤销',undoNode,!flowUndo.length]];
  menu.setAttribute('role','menu');
  actions.forEach(([name,action,disabled])=>{const button=document.createElement('button');button.textContent=name;button.disabled=disabled;button.setAttribute('role','menuitem');button.onclick=()=>{menu.hidden=true;action();};menu.append(button);});
  const left=$('sidebar').getBoundingClientRect().left;
  menu.style.left=Math.max(left+8,Math.min(event.clientX||left+20,innerWidth-145))+'px';menu.hidden=false;menu.style.top=Math.max(4,Math.min(event.clientY||160,innerHeight-menu.offsetHeight-8))+'px';
  menu.querySelector('button:not(:disabled)')?.focus();
  menu.onkeydown=e=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(e.key))return;e.preventDefault();const items=[...menu.querySelectorAll('button:not(:disabled)')],index=items.indexOf(document.activeElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(index+(e.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();};
}
function showInsertMenu(anchor,ownerId,index){
  if(scraping||detecting)return;
  const menu=$('nodeContext');menu.replaceChildren();menu.setAttribute('role','menu');
  menu.classList.add('flow-add-menu');
  const items=[['list','循环','M5 8h14l-3-3M19 16H5l3 3M5 8v4m14 0v4'],['scrollLoop','循环滚动网页','M5 8h14l-3-3M19 16H5l3 3M5 8v4m14 0v4'],['click','点击元素','m8 5 3 15 3-6 6-3ZM4 4 2 2m8 0v2M2 10h2'],['extract','提取数据','M4 4h15v13H4ZM7 8h9M7 12h5m3 6 3 3 3-3'],['open','打开网页','M3 4h18v16H3ZM3 8h18m-9 4 5 3-5 3'],['back','返回上一级网页','m8 4-5 5 5 5M3 9h12a5 5 0 0 1 0 10'],['hover','移动鼠标到元素上','M4 19V4h15v10M9 9l3 12 3-6 6-3Z'],['select','切换下拉选项','M4 4h16v16H4ZM4 9h16m-8 4 3 3 3-3'],['input','输入文本','M4 4h12v16H4Zm4 4h4m-4 4h4m7-1v9m-2-9h4m-4 9h4'],['captcha','识别验证码','M3 6h18v12H3ZM7 9v6m4-6h3l-3 6h3m3-6h2v6h-2'],['condition','判断条件','M12 3v6M5 20v-6h14v6M12 9v5M10 3h4']];
  for(const [type,label,icon] of items){
    if(['open','input','condition'].includes(type)){const divider=document.createElement('hr');divider.setAttribute('role','separator');menu.append(divider);}
    const button=document.createElement('button'),glyph=document.createElement('span');glyph.className='flow-menu-icon';glyph.setAttribute('aria-hidden','true');glyph.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="'+icon+'"/></svg>';button.append(glyph,document.createTextNode(label));button.dataset.insertType=type;button.setAttribute('role','menuitem');
    button.onclick=()=>{
      menu.hidden=true;if(scraping||detecting)return;
      const nodes=ownerId?Workflow.find(ensureFlow(),ownerId)?.node.children:ensureFlow();
      if(!nodes||index>nodes.length)return;
      const node=Workflow.node(type);node.name=label;const proposed=structuredClone(cfg.flow);
      const target=ownerId?Workflow.find(proposed,ownerId).node.children:proposed;
      target.splice(index,0,node);
      try{Workflow.validate(proposed);}catch(error){toast(error.message);return;}
      rememberFlow();nodes.splice(index,0,node);markSettingsDirty();selectNode(node.id);toast('已插入'+node.name);
    };menu.append(button);
  }
  const rect=anchor.getBoundingClientRect(),left=$('sidebar').getBoundingClientRect().left;
  menu.style.left=Math.max(left+8,Math.min(rect.left,innerWidth-192))+'px';menu.hidden=false;
  menu.style.top=Math.max(8,Math.min(rect.bottom+4,innerHeight-menu.offsetHeight-8))+'px';
  menu.querySelector('button')?.focus();
  menu.onkeydown=event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const items=[...menu.querySelectorAll('button')],i=items.indexOf(document.activeElement);items[event.key==='Home'?0:event.key==='End'?items.length-1:(i+(event.key==='ArrowDown'?1:items.length-1))%items.length]?.focus();};
}
document.addEventListener('keydown',event=>{if(event.key==='Escape')$('nodeContext').hidden=true;});
document.addEventListener('click',event=>{if(!$('nodeContext').contains(event.target))$('nodeContext').hidden=true;});
async function openPanelDialog(id){
  const result=await cmd('panel-dialog',{open:true,keepPage:['tableFieldsDialog','resultsDialog'].includes(id)&&!$('tablePageBackdrop')});
  if(result.backdrop){
    $('tablePageBackdrop')?.remove();const image=document.createElement('img');image.id='tablePageBackdrop';image.alt='当前网页';image.src=result.backdrop.image;
    const {x,y,width,height}=result.backdrop.bounds;image.style.cssText=`position:fixed;left:${x}px;top:${y}px;width:${width}px;height:${height}px;pointer-events:none;z-index:30`;document.body.append(image);
  }
  if(!$(id).open)$(id).showModal();syncRunPage();
}
for(const id of ['triggerDialog','resultsDialog','messageDialog','tasksDialog','tableFieldsDialog','userAgentDialog','proxyPoolDialog'])$(id).addEventListener('close',async()=>{const open=!!document.querySelector('dialog[open]');if(!open)$('tablePageBackdrop')?.remove();await cmd('panel-dialog',{open});syncRunPage();});
function syncRunPage(){
  const slot=$('runPageSlot');
  const visible=$('resultsDialog').open&&!slot.hidden&&!$('messageDialog').open&&!$('triggerDialog').open&&!$('tasksDialog').open&&!$('tableFieldsDialog').open&&!$('userAgentDialog').open&&!$('proxyPoolDialog').open&&!resultRunId;
  const r=slot.getBoundingClientRect();
  return cmd('run-page',{visible,bounds:{x:r.x,y:r.y,width:r.width,height:r.height}});
}
new ResizeObserver(()=>syncRunPage()).observe($('runPageSlot'));
window.addEventListener('resize',syncRunPage);
$('btnToggleRunBottom').onclick=()=>{
  const collapsed=$('resultsDialog').classList.toggle('run-bottom-collapsed');
  const button=$('btnToggleRunBottom');
  button.setAttribute('aria-expanded',String(!collapsed));
  button.title=collapsed?'展开任务区':'收起任务区';button.setAttribute('aria-label',button.title);
  syncRunPage();
};
$('btnShowRunPage').onclick=async()=>{
  const slot=$('runPageSlot');slot.hidden=!slot.hidden;
  if(!slot.hidden){$('resultsDialog').classList.add('run-bottom-collapsed');$('btnToggleRunBottom').setAttribute('aria-expanded','false');$('btnToggleRunBottom').title='展开任务区';}
  $('resultsDialog').classList.toggle('show-run-page',!slot.hidden);
  $('btnShowRunPage').textContent=slot.hidden?'显示网页':'隐藏网页';
  await syncRunPage();
};
$('btnMessageClose').onclick=()=>$('messageDialog').close();
$('btnMessageConfirm').onclick=()=>$('messageDialog').close();
let triggerNode=null,triggerGroups=[];
function editTrigger(node){triggerNode=node;triggerGroups=[[{field:cfg.fields[0]?.name||'',op:'empty',value:''}]];$('triggerName').value='过滤空数据';drawTriggerGroups();openPanelDialog('triggerDialog');}
function drawTriggerGroups(){
  const wrap=$('triggerGroups');wrap.replaceChildren();
  triggerGroups.forEach((group,groupIndex)=>{
    const section=document.createElement('fieldset');const legend=document.createElement('legend');legend.textContent='条件组 '+(groupIndex+1);section.append(legend);
    group.forEach((rule,index)=>{
      const row=document.createElement('div');row.className='trigger-row';
      const field=document.createElement('select');cfg.fields.forEach(f=>field.add(new Option(f.name,f.name)));field.value=rule.field;field.onchange=()=>rule.field=field.value;
      const op=document.createElement('select');[['为空','empty'],['不为空','notEmpty'],['等于','eq'],['不等于','ne'],['包含','contains'],['不包含','notContains'],['大于','gt'],['小于','lt']].forEach(([label,value])=>op.add(new Option(label,value)));op.value=rule.op;op.onchange=()=>rule.op=op.value;
      const value=document.createElement('input');value.placeholder='比较值';value.value=rule.value;value.oninput=()=>rule.value=value.value;
      const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.onclick=()=>{group.splice(index,1);if(!group.length)triggerGroups.splice(groupIndex,1);drawTriggerGroups();};row.append(field,op,value,remove);section.append(row);
    });
    const add=document.createElement('button');add.type='button';add.className='mini';add.textContent='+ 添加且条件';add.onclick=()=>{group.push({field:cfg.fields[0]?.name||'',op:'empty',value:''});drawTriggerGroups();};section.append(add);wrap.append(section);
  });
}
$('btnTriggerOr').onclick=()=>{triggerGroups.push([{field:cfg.fields[0]?.name||'',op:'empty',value:''}]);drawTriggerGroups();};
$('btnTriggerSave').onclick=()=>{if(!triggerGroups.length){toast('请添加条件');return;}rememberFlow();(triggerNode.params.triggers||=[]).push({name:$('triggerName').value.trim()||'过滤数据',groups:structuredClone(triggerGroups)});$('triggerDialog').close();selectNode(triggerNode.id);};
let resultPage=0,resultTab='data',resultRunId=null;
let runResultsTimer=null;
let runResultsVersion=0,resultPageCount=1,runBodyKey=null;
function scheduleRunResults(){
  if(runResultsTimer)return;
  runResultsTimer=setTimeout(async()=>{runResultsTimer=null;if($('resultsDialog').open&&!resultRunId)await drawRunResults();},300);
}
async function drawRunResults(){
  const version=++runResultsVersion;
  const result=await cmd('run-results',{page:resultPage,id:resultRunId});if(!result.ok||version!==runResultsVersion)return;
  const history=resultTab==='history'?await cmd('run-history',{}):null;
  if(version!==runResultsVersion)return;
  resultPage=result.page;
  resultPageCount=Math.max(1,Math.ceil(result.total/result.pageSize));
  const summary=result.summary||{};const seconds=(summary.durationMs||0)/1000;
  if(summary.running)setStartBtn(true);
  $('resultsDialog').querySelector('h3').textContent=summary.running?'正在采集':summary.error?'采集遇到问题':summary.stopped?'采集已停止':'采集已完成';
  $('resultsDialog').classList.toggle('is-running',!!summary.running);
  $('resultsDialog').classList.toggle('has-error',!!summary.error);
  $('runCount').textContent=result.total.toLocaleString();
  $('runSummary').textContent=`重复 ${summary.duplicates||0} 条　 ·　过滤 ${summary.filtered||0} 条　 ·　用时 ${seconds.toFixed(1)} 秒　 ·　平均 ${seconds?Math.round(result.total/seconds*60):0} 条/分钟`;
  $('btnResultStop').hidden=!summary.running;$('btnResultRerun').disabled=!!summary.running;
  $('btnShowRunPage').disabled=!!resultRunId;
  syncRunPage();
  $('runLiveStep').textContent=summary.error?'采集失败，详细原因请查看任务日志': (summary.running?$('progressText').textContent:'已保留本次采集数据，可查看或导出');
  if(summary.pending)$('runLiveStep').textContent+=' · 当前页 '+summary.pending+' 条实时预览，横向滚动时继续补齐列';
  for(const [id,tab] of [['btnResultData','data'],['btnResultLogTab','logs'],['btnResultHistory','history']])$(id).classList.toggle('active',resultTab===tab);
  const body=$('runResultsBody'),scrollTop=body.scrollTop,scrollLeft=body.scrollLeft;
  const bodyKey=JSON.stringify([resultRunId,resultTab,resultPage,result.fields,resultTab==='data'?result.rows:resultTab==='logs'?result.logs:history.history]);
  const redraw=bodyKey!==runBodyKey;
  if(redraw){runBodyKey=bodyKey;body._virtualCleanup?.();body.replaceChildren();
  if(resultTab==='data'){
    renderVirtualResults(body,result.fields,result.rows,resultPage*result.pageSize);
  }else if(resultTab==='logs'){
    result.logs.slice().reverse().forEach(log=>{const line=document.createElement('p');line.textContent=`[${new Date(log.time).toLocaleTimeString('zh-CN',{hour12:false})}] ${log.message}`;body.append(line);});
    body.scrollTop=scrollTop;
  }else{
    (history.history||[]).forEach(item=>{const line=document.createElement('p');line.textContent=`${new Date(item.at).toLocaleString()} · ${item.name||'未命名任务'} · ${item.total} 条 · ${item.error|| (item.stopped?'已停止':'完成')} `;const open=document.createElement('button');open.className='mini';open.textContent='查看数据';open.onclick=()=>{resultRunId=item.id;resultPage=0;resultTab='data';drawRunResults();};line.append(open);body.append(line);});
  }
  }
  $('resultPage').textContent=`${resultPage+1} / ${resultPageCount}`;
  $('resultTotal').textContent=`共 ${result.total.toLocaleString()} 条`;
  if(document.activeElement!==$('resultJump'))$('resultJump').value=resultPage+1;
  $('resultJump').disabled=result.total===0;
  body.scrollLeft=scrollLeft;
  if(resultTab==='data')body.scrollTop=scrollTop;
  $('resultPage').parentElement.hidden=resultTab!=='data';
  $('btnResultPrev').disabled=resultTab!=='data'||resultPage===0;$('btnResultNext').disabled=resultTab!=='data'||resultPage+1>=resultPageCount;
  if(summary.running&&$('resultsDialog').open&&!resultRunId){if(!runResultsTimer)runResultsTimer=setTimeout(()=>{runResultsTimer=null;if($('resultsDialog').open)drawRunResults();},1000);}
}
$('btnResultStop').onclick=async()=>{$('runLiveStep').textContent='正在停止，保留已采集数据…';await cmd('scrape-stop');};
$('btnRunResults').onclick=async()=>{resultRunId=null;resultPage=0;resultTab='data';await drawRunResults();openPanelDialog('resultsDialog');};
$('btnTaskLogs').onclick=async()=>{resultRunId=null;resultPage=0;resultTab='logs';await drawRunResults();await openPanelDialog('resultsDialog');};
$('btnResultClose').onclick=()=>$('resultsDialog').close();
$('btnResultRerun').onclick=()=>{$('resultsDialog').close();startScrape();};
async function exportRun(format){const result=await cmd(resultRunId?'export-run':'export',{id:resultRunId,format});if(result.ok)toast('已导出：'+result.path);}
$('btnResultCsv').onclick=()=>exportRun('csv');$('btnResultXlsx').onclick=()=>exportRun('xlsx');
$('btnRestoreBackup').onclick=async()=>{const result=await cmd('recover-result-backup',{});if(result.ok&&!result.canceled){resultRunId=null;resultPage=0;resultTab='data';runBodyKey=null;await drawRunResults();}};
$('btnResultLogs').onclick=async()=>{const result=await cmd('export-logs',{id:resultRunId});if(result.ok)toast('已导出：'+result.path);};
function goResultPage(page){
  resultPage=Math.max(0,Math.min(resultPageCount-1,page));
  $('resultJump').value=resultPage+1;$('runResultsBody').scrollTop=0;
  return drawRunResults();
}
$('btnResultPrev').onclick=()=>goResultPage(resultPage-1);$('btnResultNext').onclick=()=>goResultPage(resultPage+1);
$('resultJump').onchange=()=>{const value=$('resultJump').value.trim();if(!/^\d+$/.test(value)){$('resultJump').value=resultPage+1;return;}return goResultPage(Number(value)-1);};
$('resultJump').onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();$('resultJump').onchange();}};
$('btnResultData').onclick=()=>{resultTab='data';drawRunResults();};$('btnResultLogTab').onclick=()=>{resultTab='logs';drawRunResults();};$('btnResultHistory').onclick=()=>{resultTab='history';drawRunResults();};
async function handleGuideAction(action){
  if(action==='stop-detect'&&detecting)return cmd('detect-stop');
  if(scraping||detecting)return;
  if(action==='next')return nextRecognition();
  if(action==='toggle-more'){recognitionMore=!recognitionMore;syncRecognitionGuide();return;}
  if(action==='modify-more'){guidePick='recognition-more';await setPicking(true);return cmd('guide',{phase:'pick',message:'请选择加载更多按钮，选择后返回识别预览。'});}
  if(action==='generate')return generateRule();
  if(action==='cancel')return cancelRecognition();
  if(action==='manual'){cancelRecognition();await cmd('guide',null);return setPicking(true);}
  if(action==='detect')return detectPage();
  if(action==='run'){if(await saveCurrentTask(true)){await cmd('guide',null);startScrape();}return;}
  if(action==='cancel-pick'){guidePick=null;await setPicking(false);if(recognitionDraft)return syncRecognitionGuide();return cmd('guide',{phase:'continue'});}
  if(action==='scroll'){installGuideLoop('scrollLoop');return cmd('guide',{phase:'continue'});}
  if(['pagination','more','detail'].includes(action)){
    guidePick=action;await setPicking(true);
    await cmd('guide',{phase:'pick',message:action==='detail'?'请点击列表项中的详情链接。':action==='more'?'请点击网页中的加载更多按钮。':'请点击网页中的下一页按钮。'});
  }
}
function installGuideLoop(type,selector){
  if(!cfg.list){toast('请先配置列表');return;}
  rememberFlow();ensureExtractionFlow();
  function findContainer(nodes){for(const n of nodes){if(['pages','loadMore','scrollLoop'].includes(n.type))return n;const hit=n.children&&findContainer(n.children);if(hit)return hit;}}
  const existing=findContainer(cfg.flow),loop=Workflow.node(type);
  if(selector){loop.params.selector=selector;loop.params.mode='css';}
  if(existing){loop.children=existing.children.filter(n=>n.type!=='next');const found=Workflow.find(cfg.flow,existing.id);found.siblings.splice(found.index,1,loop);}
  else{
    const findList=nodes=>{for(const node of nodes){if(node.type==='list')return node;const child=node.children&&findList(node.children);if(child)return child;}};
    const listNode=findList(cfg.flow);
    if(listNode){const found=Workflow.find(cfg.flow,listNode.id);loop.children=[listNode];found.siblings.splice(found.index,1,loop);}
    else{const list=Workflow.node('list');list.params.list=cfg.list;list.children=[Workflow.node('extract')];loop.children=[list];cfg.flow.push(loop);}
  }
  if(type==='pages'){const next=Workflow.node('next');next.params={selector,mode:'css'};loop.children.push(next);cfg.nextSel={type:'css',selector};$('optNext').checked=true;}
  selectNode(loop.id);toast('已配置'+loop.name+'，可在右侧调整次数与间隔');
}
async function completeGuidePick(p){
  const action=guidePick;if(!action)return;
  if(action==='detail'&&!p.href){toast('请选择带有页面地址的链接');return;}
  guidePick=null;await setPicking(false);
  if(action==='recognition-more'){recognitionMoreSelector=p.path;recognitionMore=true;syncRecognitionGuide();return;}
  if(action==='detail'){
    const result=await cmd('detail-selector',{path:p.path,list:cfg.list});
    if(!result.ok){toast(result.error);await cmd('guide',{phase:'continue'});return;}
    rememberFlow();const findList=nodes=>{for(const node of nodes){if(node.type==='list')return node;const child=node.children&&findList(node.children);if(child)return child;}};
    const list=findList(ensureFlow());if(!list){toast('请先配置循环列表');return;}
    const detail=Workflow.node('detail');detail.params={selector:result.data.selector,relative:true};list.children.push(detail);selectNode(detail.id);toast('已添加逐项进入详情并返回步骤，请配置详情提取字段');
  }else installGuideLoop(action==='more'?'loadMore':'pages',p.path);
  await cmd('guide',{phase:'continue'});
}
async function editHeader(th,field,index){
  if(!field||scraping||detecting||columnBusy||th.querySelector('input'))return;
  lockTableWidths();
  const old=field.name,input=document.createElement('input');input.className='header-editor';input.value=old;input.maxLength=80;input.setAttribute('aria-label','字段名称');th.replaceChildren(input);input.focus();input.select();let finished=false;
  const finish=async cancel=>{
    if(finished)return;const name=input.value.trim();
    if(!cancel&&(!name||cfg.fields.some(f=>f!==field&&f.name===name))){toast(!name?'字段名称不能为空':'字段名称已存在');input.focus();return;}
    finished=true;
    if(cancel||name===old){th.textContent=old;return;}
    const result=await cmd('rename-result-field',{index,oldName:old,name});
    if(!result.ok){th.textContent=old;return;}
    field.name=name;
    const update=nodes=>nodes.forEach(node=>{for(const trigger of node.params?.triggers||[])for(const group of trigger.groups||[])for(const rule of group)if(rule.field===old)rule.field=name;if(node.children)update(node.children);});update(ensureFlow());
    th.textContent=name;renderFields();toast('字段已改名为“'+name+'”，保存规则后生效');
  };
  input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();finish(false);}if(event.key==='Escape'){event.preventDefault();finish(true);}};input.onblur=()=>finish(false);
}


function showConfigError(input){
  const label=input.closest('label');
  const name=input.getAttribute('aria-label')||([...label?.childNodes||[]].filter(node=>node.nodeType===3||node.nodeName==='SPAN').map(node=>node.textContent).join('').trim())||input.placeholder||'配置项';
  const validity=input.validity;
  const reason=validity.badInput?'请输入有效数字':!input.value||validity.valueMissing?'不能为空':validity.rangeUnderflow?'不能小于 '+input.min:validity.rangeOverflow?'不能大于 '+input.max:validity.stepMismatch?'请输入符合步长 '+(input.step||'1')+' 的数值':validity.tooLong?'最多允许 '+input.maxLength+' 个字符':input.validationMessage||'格式不正确';
  const pane=input.closest('.tabpane');if(pane)document.querySelector('[data-tab="'+pane.id.replace('tab-','')+'"]')?.click();
  for(let parent=input.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;
  toast(name+'：'+reason+(input.value?'（当前值：'+input.value+'）':''));
  input.scrollIntoView({block:'nearest'});input.focus();
}
for(const event of ['input','change'])$('sidebar').addEventListener(event,e=>{if(e.target.matches('input,select,textarea'))markSettingsDirty();});
$('btnApplySettings').onclick=async()=>{
  if(scraping||detecting)return;
  const inputs=[...$('settingsPanel').querySelectorAll('input,select,textarea')];
  const invalid=inputs.find(el=>el.getClientRects().length&&!el.checkValidity());if(invalid){showConfigError(invalid);return;}
  if(!await applyCurrentNode())return;
  const node=currentNode();
  if(node?.type==='list'&&!await applyListSettings())return;
  if(node?.type==='next'&&!applyNextSettings())return;
  const options=readOptions();if(!options)return;
  try{Workflow.validate(ensureFlow());}catch(e){toast(e.message);return;}
  cfg.opts=options;settingsDirty=false;syncSaveState();toast('应用成功');
};

$('sidebar').addEventListener('click',e=>{if(e.target.closest('#btnAddField,.field-remove'))markSettingsDirty();});

/* Keep native select values/events; replace only the operating-system popup. */
let selectPopup=null;
function closeSelectPopup(restoreFocus=false){
  if(!selectPopup)return;
  const {select,popup}=selectPopup;popup.remove();select.removeAttribute('aria-expanded');select.removeAttribute('aria-controls');selectPopup=null;
  if(restoreFocus&&select.isConnected)select.focus();
}
function openSelectPopup(select){
  closeSelectPopup();
  const popup=document.createElement('div');popup.className='select-options';popup.id='selectOptions';popup.setAttribute('role','listbox');
  const rect=select.getBoundingClientRect();popup.style.width=Math.max(rect.width,120)+'px';
  const choose=index=>{if(!select.isConnected||select.disabled)return closeSelectPopup();select.selectedIndex=index;select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));closeSelectPopup(true);};
  [...select.options].forEach((option,index)=>{
    if(option.hidden)return;
    const button=document.createElement('button');button.type='button';button.textContent=option.text;button.disabled=option.disabled||option.parentElement.disabled;button.setAttribute('role','option');button.setAttribute('aria-selected',String(option.selected));button.tabIndex=-1;button.onclick=()=>choose(index);popup.append(button);
  });
  (select.closest('dialog[open]')||document.body).append(popup);selectPopup={select,popup};
  select.setAttribute('aria-expanded','true');select.setAttribute('aria-controls',popup.id);
  popup.style.left=Math.max(6,Math.min(rect.left,innerWidth-popup.offsetWidth-6))+'px';
  const below=innerHeight-rect.bottom-8,above=rect.top-8,height=Math.min(240,popup.scrollHeight+2);
  const downward=below>=height||below>=above;popup.style.maxHeight=Math.max(32,Math.min(240,downward?below:above))+'px';
  popup.style.top=(downward?rect.bottom+4:Math.max(4,rect.top-popup.offsetHeight-4))+'px';
  const buttons=[...popup.querySelectorAll('button:not(:disabled)')];
  const focus=button=>{button?.focus({preventScroll:true});button?.scrollIntoView({block:'nearest'});};
  focus(buttons.find(button=>button.getAttribute('aria-selected')==='true')||buttons[0]);
  popup.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeSelectPopup(true);}
    else if(event.key==='Tab')closeSelectPopup(true);
    else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const i=buttons.indexOf(document.activeElement);focus(buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(i+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length]);}
    else if(event.key.length===1&&event.key!==' '){const next=buttons.find(button=>button.textContent.toLowerCase().startsWith(event.key.toLowerCase()));focus(next);}
  };
}
document.addEventListener('pointerdown',event=>{
  const select=event.target.closest('select:not([multiple])');
  if(select&&!select.disabled&&select.size<=1){event.preventDefault();if(selectPopup?.select===select)closeSelectPopup(true);else openSelectPopup(select);}
  else if(selectPopup&&!selectPopup.popup.contains(event.target))closeSelectPopup();
},true);
document.addEventListener('keydown',event=>{const select=event.target.closest('select:not([multiple])');if(select&&!select.disabled&&select.size<=1&&['ArrowDown','ArrowUp','Enter',' '].includes(event.key)){event.preventDefault();openSelectPopup(select);}});
window.addEventListener('resize',()=>closeSelectPopup());
document.addEventListener('scroll',event=>{if(selectPopup&&!selectPopup.popup.contains(event.target))closeSelectPopup();},true);
document.addEventListener('close',()=>closeSelectPopup(),true);

