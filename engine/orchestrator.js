'use strict';
/**
 * 采集编排器（主进程侧状态机）：
 * 每页 = 等待加载 → 校验选择器 → 滚动采集 → (可选)翻页 → 下一页
 */
const pagecode = require('./pagecode');
const {executeInput} = require('./input-action');
const Workflow = require('./workflow');
const Navigation = require('./navigation-action');
const Retry = require('./node-retry');

class Scraper {
  /**
   * view: WebContentsView
   * deps: { cfg, opts, onLog, onProgress, onRows, onDone, onError }
   * opts: { scrollLoad, autoNext, maxPages, maxScrollSec, scrollWait, maxRows }
   */
  constructor(view, deps) {
    this.view = view;
    this.cfg = deps.cfg;
    this.opts = deps.opts || {};
    this.onLog = deps.onLog || (() => {});
    this.onProgress = deps.onProgress || (() => {});
    this.onRows = deps.onRows || (() => {});
    this.onDone = deps.onDone || (() => {});
    this.onError = deps.onError || (() => {});
    this.stopped = false;
    this.clock=deps.clock||(()=>performance.now());this.clockStarted=this.clock();
    this.stopListeners=new Set();
    this.pages = 0;
    this.total = 0;
    this.visited = new Set();
    this.zeroNewStrikes = 0;
    this.duplicates=0; this.filtered=0;
  }

  async setTableZoom(zoom){
    const wc=this.view.webContents;wc.setZoomFactor(zoom);
    if(wc.runViewport)await require('./run-viewport').lockRunViewport(wc,wc.runViewport);
  }
  async restoreTableZoom(scope){
    if(scope?.originalZoom===undefined)return;
    if(!this.view.webContents.isDestroyed?.())await this.setTableZoom(scope.originalZoom);
    delete scope.originalZoom;delete scope.tableKey;delete this.tableOriginalZoom;
  }
  async collectTable(cfg,opts,collect,scope){
    if(!opts.fitTable)return collect();
    if(this.view.webContents.runViewport){
      if(!this.layoutZoomNotice){this.layoutZoomNotice=true;this.onLog('已固定录制布局，使用横向滚动采集隐藏列，避免网页缩放改变布局');}
      return collect();
    }
    const key=JSON.stringify(cfg.list);
    if(scope?.tableKey===key)return collect();
    if(scope)await this.restoreTableZoom(scope);
    const wc=this.view.webContents,original=wc.getZoomFactor();this.tableOriginalZoom=original;
    if(scope)scope.originalZoom=original;
    try{
      const measure=await this.exec(`cfg=>{
        const list=cfg.list;if(!list?.selector)return null;
        const first=list.type==='xpath'?document.evaluate(list.selector,document,null,9,null).singleNodeValue:document.querySelector(list.selector);
        if(list.genericGrid){
          for(let p=first?.parentElement;p;p=p.parentElement){if(/auto|scroll/.test(getComputedStyle(p).overflowX)&&p.scrollWidth>p.clientWidth+1)return {width:p.scrollWidth,available:p.clientWidth};}
          return null;
        }
        const table=first?.closest('.vxe-table,table');if(!table)return null;
        const region=table.querySelector('.vxe-table--main-wrapper .vxe-table--body-inner-wrapper')||table.querySelector('.vxe-table--main-wrapper .vxe-table--body-wrapper')||table.parentElement;
        return {width:Math.max(region.scrollWidth,table.scrollWidth),available:region.clientWidth};
      }`,cfg);
      if(measure.ok&&measure.data?.width>measure.data.available){
        await this.setTableZoom(Math.max(.25,Math.min(original,original*measure.data.available/measure.data.width)));
        await this.wait(350);
        const ready=await this.exec(pagecode.countCode(),cfg);
        if(!ready.ok||!ready.data?.count){await this.setTableZoom(original);await this.wait(350);this.onLog('缩放后定位未就绪，已恢复原比例采集');}
        else this.onLog('表格缩放至 '+Math.round(wc.getZoomFactor()*100)+'%，仍有隐藏列时继续横向扫描');
      }
      if(scope){scope.originalZoom=original;scope.tableKey=key;}
      return await collect();
    }finally{if(!scope){if(!wc.isDestroyed?.())await this.setTableZoom(original);delete this.tableOriginalZoom;}}
  }

  now() { return this.clock(); }
  elapsedMs() { return Math.max(0,this.now()-this.clockStarted); }
  stop() {
    if(this.stopped)return;
    this.stopped = true;
    this.view.webContents.stop();
    // 中断正在网页里运行的滚动等待，不必等整段注入脚本结束。
    this.view.webContents.executeJavaScript('window.__v6collectStopped = true').catch(() => {});
    for(const cancel of this.stopListeners)cancel();
  }

  async wait(ms) {
    if(this.stopped)return;
    let timer;
    try{await this.interruptible(new Promise(resolve=>{timer=setTimeout(resolve,Math.max(0,ms));}));}
    catch(error){if(!this.stopped)throw error;}
    finally{clearTimeout(timer);}
  }

  async interruptible(promise,timeoutMs,stopGraceMs=0) {
    if(this.stopped)throw Error('stopped');
    let timer,stopTimer,cancel;
    const stopped=new Promise((_,reject)=>{cancel=()=>{if(stopGraceMs)stopTimer=setTimeout(()=>reject(Error('stopped')),stopGraceMs);else reject(Error('stopped'));};this.stopListeners.add(cancel);});
    try{return await Promise.race([promise,stopped,...(timeoutMs===undefined?[]:[new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('操作响应超时，已停止采集')),timeoutMs);})])]);}
    finally{clearTimeout(timer);clearTimeout(stopTimer);this.stopListeners.delete(cancel);}
  }
  async collect(cfg,opts){
    this.collecting=true;
    try{return await this.exec(pagecode.scrollCollectCode(),cfg,opts);}
    finally{this.collecting=false;}
  }
  async exec(code, ...args) {
    if (this.stopped) return Promise.resolve({ ok: false, error: 'stopped' });
    const argSrc = args.map(a => JSON.stringify(a == null ? null : a)).join(',');
    this.pendingPageExecution=this.view.webContents.executeJavaScript(`(${code})(${argSrc})`, true);
    return this.interruptible(this.pendingPageExecution,this.collecting?undefined:Math.max(1000,(this.opts.loadTimeoutSec??25)*1000),this.collecting?250:0)
      .then(r => (r && typeof r === 'object') ? (r.ok === false ? r : { ok: true, data: r }) : { ok: true, data: r })
      .catch(err => ({ ok: false, error: String(err && err.message || err).slice(0, 200) }));
  }

  async waitLoad(timeoutMs) {
    const wc = this.view.webContents;
    const deadline=this.now()+(timeoutMs??25000);
    while(!this.stopped){if(!wc.isLoading())return;if(this.now()>=deadline)throw Error('页面加载超时');await this.wait(50);}
  }

  async runAction(node,cfg,itemIndex) {
    const started=this.now(),seconds=Number(node.params?.timeout??(node.params?.optional?1:this.opts.loadTimeoutSec??25));
    let result=await this.exec(pagecode.flowActionCode(),node,cfg,itemIndex),logged=false;
    while(!result.ok&&result.retryable&&!this.stopped&&this.now()-started<seconds*1000){
      if(!logged){this.onLog((node.name||'输入控件')+'：'+result.error+'，就绪后立即执行（最长 '+seconds+' 秒）');logged=true;}
      await this.wait(Math.min(100,Math.max(0,seconds*1000-(this.now()-started))));
      if(this.stopped)break;
      result=await this.exec(pagecode.flowActionCode(),node,cfg,itemIndex);
    }
    if(logged&&result.ok)this.onLog((node.name||'输入控件')+'：已就绪，等待 '+((this.now()-started)/1000).toFixed(1)+' 秒');
    if(!result.ok&&result.retryable&&!this.stopped)result.error+='；实际等待 '+((this.now()-started)/1000).toFixed(1)+' 秒；等待上限来自'+(node.params?.timeout!=null?'该节点设置':'任务页面加载超时')+'；当前网址：'+this.view.webContents.getURL()+'。若页面仍在加载，请提高等待上限；若已加载完成，请检查前置步骤、iframe 和元素定位';
    return result;
  }

  async run() {
    if (this.cfg.flow) return this.runFlow();
    const opts = this.opts;
    const maxPages = opts.autoNext ? Math.max(1, opts.maxPages || 1) : 1;
    const maxRows = opts.maxRows || 200000;
    try {
      this.onProgress({ phase: 'start' });
      for (let page = 1; page <= maxPages; page++) {
        if (this.stopped) break;
        this.pages = page;
        await this.waitLoad((opts.loadTimeoutSec ?? 25) * 1000);
        await this.wait((opts.beforeWaitSec || 0) * 1000);
        if (this.stopped) break;

        // 每页校验已配置的列表，避免错误定位污染后续数据。
        const cnt = await this.exec(pagecode.countCode(), this.cfg);
        if (!cnt.ok || !cnt.data || cnt.data.count === 0) {
          // 手动定位和字段配置不可被自动识别静默替换。
          throw new Error(`第${page}页列表定位失效，请检查循环列表选择器`);
        }

        this.onProgress({ phase: 'page', page, items: cnt.data ? cnt.data.count : 0 });

        // 滚动采集当前页
        const r = await this.collectTable(this.cfg,opts,()=>this.collect(this.cfg, {
          scrollLoad: opts.scrollLoad !== false,
          maxScrollSec: opts.maxScrollSec ?? 40,
          scrollWait: opts.scrollWait ?? 700,
          maxRows:maxRows-this.total,
        }));
        if (!r.ok) {
          if(this.stopped)break;
          throw new Error(`第${page}页采集失败：${r.error || '未知错误'}`);
        }
        const rows = (r.data && r.data.rows) || [];
        const newRows = this.dedupe(rows).slice(0,maxRows-this.total);
        this.total += newRows.length;
        this.onProgress({ phase: 'page-done', page, added: newRows.length, total: this.total, rounds: r.data && r.data.rounds });
        if (newRows.length) this.onRows(newRows);
        if(this.stopped)break;
        if(r.data.error)throw Error(r.data.error);
        if(r.data.reason==='达到滚动时间上限')throw Error('列表尚未确认滚动完成，已保留当前数据并停止翻页。请增加滚动上限后重试');

        if (this.total >= maxRows) { this.onLog('已达最大条数限制'); break; }

        // 翻页
        if (page >= maxPages) break;
        if (!opts.autoNext) break;
        this.onProgress({ phase: 'next', page });
        const nx = await this.exec(pagecode.clickNextCode(), this.cfg.nextSel || null);
        if (this.stopped) break;
        if (!nx.ok || !nx.data || nx.data.ok === false) {
          this.onLog('没有找到"下一页"，采集结束');
          break;
        }
        const href = nx.data.href;
        if (nx.data.mode === 'nav' && href) {
          if (this.visited.has(href)) { this.onLog('下一页地址已访问过，防止死循环，停止'); break; }
          this.visited.add(href);
          await Navigation.navigate(this,href,opts.loadTimeoutSec??25);
          this.onLog(`已打开第${page + 1}页`);
        } else {
          this.onLog(`第${page}页完成，翻页：${nx.data.text || '点击'}`);
        }
        const urlBefore = this.view.webContents.getURL();
        await this.waitLoad((opts.loadTimeoutSec ?? 25) * 1000);
        this.onLog('翻页加载完成');
        // SPA 页面 URL 不变也没有加载事件：靠连续 0 新增行中断
        const urlAfter = this.view.webContents.getURL();
        if (urlAfter === urlBefore && newRows.length === 0) {
          this.zeroNewStrikes++;
          if (this.zeroNewStrikes >= 2) { this.onLog('连续翻页无新数据，停止'); break; }
        } else {
          this.zeroNewStrikes = 0;
        }
        await this.wait((opts.nextWaitSec ?? 1.2) * 1000);
      }
      this.onDone({ pages: this.pages, totalRows: this.total });
    } catch (err) {
      this.onError(err.message || String(err));
    }
  }

  async beforeNode(node) {
    const before=node.params?.before;
    if(!before?.enabled)return;
    const seconds=before.mode==='random'?3+Math.random()*12:Number(before.seconds??0);
    this.onLog(node.name+'：执行前等待 '+seconds.toFixed(1)+' 秒');
    await this.wait(seconds*1000);
    if(this.stopped||!before.waitElement)return;
    const deadline=this.now()+Number(before.timeout??25)*1000;
    while(!this.stopped){
      const result=await this.exec(require('./node-target').inspectTarget.toString(),before);
      if(!result.ok)throw Error('等待元素定位失败：'+result.error);
      if(result.data?.exists)return;
      if(this.now()>=deadline)throw Error('等待指定元素出现超时');
      await this.wait(200);
    }
  }

  async waitForList(cfg,timeoutMs) {
    const deadline=this.now()+timeoutMs;let prior='',stableSince=0,notified=false,lastError='';
    while(!this.stopped){
      const result=await this.exec(pagecode.countCode(),cfg);
      if(result.code==='INVALID_SELECTOR')throw Error(result.error);
      if(result.ok&&result.data.count>0){
        const signature=JSON.stringify(result.data);
        if(signature!==prior){prior=signature;stableSince=this.now();}
        if(this.now()-stableSince>=400||timeoutMs===0){if(notified)this.onLog('列表已加载：'+result.data.count+' 项');return result;}
      }else{prior='';stableSince=0;lastError=result.error||'';}
      if(this.now()>=deadline)throw Error('等待列表加载超时（'+(timeoutMs/1000)+'秒）：'+(prior?'列表持续变化，尚未稳定。':'当前页面未匹配列表。')+' 当前网址：'+this.view.webContents.getURL()+'；列表定位：'+JSON.stringify(cfg.list)+'。请检查是否仍在登录/验证页，或误用了商品详情的列表定位。'+(lastError?' '+lastError:''));
      if(!notified){this.onLog('等待列表加载，最长 '+(timeoutMs/1000)+' 秒…');notified=true;}
      await this.wait(Math.min(200,Math.max(0,deadline-this.now())));
    }
    return null;
  }

  async runFlow() {
    const started=this.now();
    let operations = 0;
    const opts = this.opts;
    const maxRows = opts.maxRows || 200000;
    const emitRows = (rows,node) => {
      const fields=(node?.params?.fields||this.cfg.fields).filter(f=>f.__on!==false);
      const output=Workflow.resultFields(this.cfg);
      const indexes=output.map(f=>fields.findIndex(x=>x.name===f.name));
      const accepted=Workflow.filterRows(rows,fields,node?.params?.triggers||[]).map(row=>indexes.map(index=>index<0?'':row[index]));
      this.filtered+=rows.length-accepted.length;
      const fresh = (node?.params?.dedupe===false?accepted:this.dedupe(accepted)).slice(0, maxRows - this.total);
      this.total += fresh.length;
      if (fresh.length) this.onRows(fresh);
      this.onProgress({ phase: 'page-done', page: this.pages || 1, added: fresh.length, total: this.total });
    };
    const navigate = (url,timeout) => Navigation.navigate(this,url,timeout);
    const pageScope=()=>({list:{type:'css',selector:'body'},itemIndex:null});
    const inheritedScope=context=>({list:context.list||this.cfg.list,itemIndex:null});
    const restoreSourceScope=context=>{
      const url=this.view.webContents.getURL();
      for(let owner=context.loopOwner;owner;owner=owner.parent){
        if(owner.sourceUrl===url){Object.assign(context.actionScope,{list:owner.list,itemIndex:owner.itemIndex});return;}
      }
      Object.assign(context.actionScope,pageScope());
    };
    const visit = async (nodes, context = {}, depth=0) => {
      // Shared by sibling/condition/retry visits; owning list URLs live separately.
      context.actionScope ||= inheritedScope(context);
      for (const node of nodes) {
        if (this.stopped || this.total >= maxRows || context.loop?.ended) return;
        if (node.enabled === false) continue;
        if (++operations > 10000) throw Error('流程执行超过 10000 步，请检查循环条件');
        const p = node.params || {};
        const committedBefore=this.total;
        let openUrl=context.retry?.id===node.id?context.retry.openUrl:undefined;
        const scope=context.actionScope;
        const cfg = { ...this.cfg, list: p.list || scope.list || this.cfg.list, fields:(p.fields||this.cfg.fields).filter(f=>f.__on!==false) };
        this.onProgress({ phase: 'node', id: node.id, name: node.name, page: this.pages });
        this.onLog('执行：' + node.name);
        try {
          await this.beforeNode(node);
          if(this.stopped)return;
          if (node.type === 'open') {
            openUrl=await Navigation.resolveOpenUrl(this,p,cfg,context,node.id);
            await Navigation.open(this,p,openUrl);
            // Fixed navigation restores the task default, or body inside detail children.
            Object.assign(scope,context.loopOwner?pageScope():inheritedScope(context));
          }
          else if (node.type === 'wait') await this.wait(Number(p.seconds ?? 1) * 1000);
          else if (['input','inputGroup'].includes(node.type)) {
            const result=await this.interruptible(executeInput(this.view.webContents,p,cfg,scope.itemIndex,action=>this.runAction(action,cfg,scope.itemIndex),async()=>{if(this.stopped)throw Error('stopped');}));
            if(!result.ok)throw Error(result.error);
            if(p.enter)await this.waitLoad((opts.loadTimeoutSec??25)*1000);
          } else if(node.type==='captcha') {
            const opened=await this.exec(pagecode.captchaCode(),'show',p);
            if(!opened.ok)throw Error(opened.error);
            this.onLog('等待人工处理验证码，完成后点击继续');
            try {
              let done=false;const deadline=this.now()+Number(p.timeout??120)*1000;
              while(!this.stopped&&this.now()<deadline){const state=await this.exec(pagecode.captchaCode(),'status',p);if(state.data?.done){done=true;break;}await this.wait(200);}
              if(!done&&!this.stopped)throw Error('等待人工处理验证码超时');
            } finally {
              const cleanup=this.view.webContents.executeJavaScript(`(${pagecode.captchaCode()})('hide')`).catch(()=>{});
              if(!this.stopped)await this.interruptible(cleanup,1000).catch(error=>{if(!this.stopped)this.onLog('验证码提示关闭失败：'+error.message);});
            }
          }
          else if(node.type==='back') {
            const history=this.view.webContents.navigationHistory;
            if(!history.canGoBack())throw Error('没有可返回的页面');
            history.goBack();await this.waitLoad((p.timeout??25)*1000);
            if(context.loopOwner)restoreSourceScope(context);
            else Object.assign(scope,inheritedScope(context));
          } else if(node.type==='condition') {
            if(['urlContains','urlEquals'].includes(p.operator)){
              if(!p.value?.trim())throw Error('请填写判断条件的网址比较值');
              const url=this.view.webContents.getURL();
              const matches=p.operator==='urlEquals'?url===p.value.trim():url.includes(p.value.trim());
              this.onLog(node.name+'：当前网址 '+url+'，条件'+(matches?'成立，执行内部步骤':'不成立，跳过内部步骤'));
              if(matches)await visit(node.children||[],context,depth+1);
              continue;
            }
            const matchesResult=r=>p.operator==='missing'?!r.exists:p.operator==='contains'?r.exists&&r.text.includes(p.value||''):r.exists;
            const deadline=this.now()+Number(p.timeout||0)*1000;
            let result=await this.exec(pagecode.flowActionCode(),node,cfg,scope.itemIndex);
            while(result.ok&&!matchesResult(result.data)&&!this.stopped&&this.now()<deadline){await this.wait(100);result=await this.exec(pagecode.flowActionCode(),node,cfg,scope.itemIndex);}
            if(this.stopped)return;
            if(!result.ok)throw Error(result.error);
            const matches=matchesResult(result.data);
            this.onLog(node.name+'：条件'+(matches?'成立，执行内部步骤':'不成立，跳过内部步骤'));
            if(matches)await visit(node.children||[],context,depth+1);
          } else if(['repeat','scrollLoop','loadMore'].includes(node.type)) {
            const containsPages=nodes=>(nodes||[]).some(child=>child.enabled!==false&&(child.type==='pages'||containsPages(child.children)));
            if(node.type==='scrollLoop'&&containsPages(node.children)){
              this.onLog(node.name+'：内部包含翻页循环，由各页列表负责滚动，外层不重复整套翻页');
              await visit(node.children||[],{...context,scrolling:false},depth+1);
              continue;
            }
            const count=Number(p.count||100);let previous='',unchanged=0;
            for(let i=0;i<count&&!this.stopped&&this.total<maxRows;i++) {
              if(i>0 && node.type==='scrollLoop') {
                const result=await this.exec(pagecode.flowActionCode(),node,cfg,null);if(!result.ok)throw Error(result.error);
                await this.wait(Number(p.seconds??1)*1000);
              }
              await visit(node.children||[],{...context,loop:{last:i===count-1,ended:false},scrolling:node.type!=='repeat'},depth+1);
              this.onLog(node.name+' 第 '+(i+1)+' 次');
              if(node.type==='loadMore' && i<count-1) {
                const result=await this.exec(pagecode.flowActionCode(),{type:'click',params:p},cfg,scope.itemIndex);
                if(!result.ok){if(!result.missing)throw Error(result.error);this.onLog('加载更多按钮不存在，结束循环');break;}
                await this.wait(Number(p.seconds??1)*1000);
              }
              if(p.stopUnchanged!==false && node.type!=='repeat') {
                const state=await this.exec('() => ({text:document.body.innerText,height:document.scrollingElement.scrollHeight})');
                const signature=JSON.stringify(state.data);unchanged=signature===previous?unchanged+1:0;previous=signature;
                if(unchanged>=3){this.onLog('内容连续三次未更新，结束循环');break;}
              }
              if(node.type==='repeat')await this.wait(Number(p.seconds??0)*1000);
            }
          }
          else if (node.type === 'pages') {
            const taskLimit=opts.autoNext===false?1:Number(opts.maxPages??999);
            const nodeLimit=p.limitEnabled===false?999:Number(p.count??999);
            const count=Math.min(taskLimit,nodeLimit);
            const loop = { zoomScope:true,ended: false, last: false, selector:p.selector?{type:Workflow.selectorMode(p),selector:p.selector,inFrame:p.inFrame,frameXPath:p.frameXPath}:null };
            try{
            for (let i = 0; i < count && !loop.ended && !this.stopped && this.total < maxRows; i++) {
              this.pages++; loop.last = i === count - 1;
              this.onLog('开始第 '+this.pages+' 页，翻页定位：'+(loop.selector?loop.selector.type+' '+loop.selector.selector:'沿用点击翻页节点'));
              await visit(node.children || [], { ...context, loop,scrolling:false },depth+1);
            }
            }finally{await this.restoreTableZoom(loop);}
          } else if (node.type === 'list') {
            const list = p.list || context.list || this.cfg.list;
            if(context.loop)context.loop.list=list;
            if (!list) throw Error('请配置循环列表');
            const ready=await this.waitForList({...cfg,list},Number(p.timeout??opts.loadTimeoutSec??25)*1000);
            if(this.stopped)return;
            const children = (node.children || []).filter(child => child.enabled !== false);
            // 仅提取时保留边滚动边收集，避免虚拟列表滚走后丢失先前数据。
            if (children.length === 1 && children[0].type === 'extract') {
              this.onProgress({ phase: 'node', id: children[0].id, name: children[0].name });
              await this.beforeNode(children[0]);
              await this.wait((opts.beforeWaitSec || 0) * 1000);
              const extractionCfg={...cfg,list,fields:(children[0].params?.fields||cfg.fields).filter(f=>f.__on!==false)};
              const check = await this.exec(pagecode.previewCode(), extractionCfg);
              if (!check.ok) throw Error(check.error);
              const result = await this.collectTable(extractionCfg,opts,()=>this.collect(extractionCfg, { ...opts, scrollLoad:context.scrolling?false:opts.scrollLoad, dedupe:children[0].params?.dedupe!==false, maxRows:maxRows-this.total }),context.loop?.zoomScope?context.loop:undefined);
              if(!result.ok){if(this.stopped)return;throw Error(result.error);}
              emitRows(result.data.rows,children[0]);
              if(this.stopped)return;
              this.onLog('列表提取结束：'+result.data.rows.length+' 条，滚动 '+result.data.rounds+' 轮，耗时 '+(result.data.ms/1000).toFixed(1)+' 秒，原因：'+(result.data.reason||'完成'));
              if(result.data.verification)this.onLog(result.data.verification);
              if(result.data.error)throw Object.assign(Error(result.data.error),{fatal:true});
              if(result.data.reason==='达到滚动时间上限')throw Object.assign(Error('列表尚未确认滚动完成，已保留当前数据并停止翻页。请增加任务采集选项中的滚动上限后重试'),{fatal:true});
            } else {
              const result = ready;
              const sourceUrl=this.view.webContents.getURL();
              const sourceBase=sourceUrl.startsWith('data:')&&this.view.webContents.__v6JsonUrl||sourceUrl;
              const openTargets=await Navigation.captureLoopUrls(this,children,cfg,list,result.data.count,sourceBase);
              if(this.stopped)return;
              // 先固定本页详情链接，返回时列表排序变化也不会漏采或重复访问。
              const detailTargets = [];
              for (let index = detailTargets.length; index < result.data.count; index++) {
                const targets = {};
                for (const child of children.filter(child => child.type === 'detail')) {
                  if (this.stopped) return;
                  const target = await this.exec(pagecode.flowActionCode(), child, { ...cfg, list }, index);
                  if (!target.ok) throw Error(child.name + '：' + target.error);
                  targets[child.id] = target.data;
                }
                detailTargets.push(targets);
              }
              for (let index = 0; index < result.data.count && !this.stopped && !context.loop?.ended && this.total < maxRows; index++){
                const itemContext={...context,list,loopOwner:{list,itemIndex:index,sourceUrl,targets:openTargets[index],parent:context.loopOwner},actionScope:pageScope(),detailTargets:detailTargets[index]};
                restoreSourceScope(itemContext);
                await visit(children,itemContext,depth+1);
              }
              // A nested loop may leave us on its final destination document.
              if(this.view.webContents.getURL()!==sourceUrl||context.loopOwner)restoreSourceScope(context);
            }
          } else if (node.type === 'detail') {
            const cached = context.detailTargets?.[node.id];
            const result = cached ? { ok: true, data: cached } : await this.exec(pagecode.flowActionCode(), node, cfg, scope.itemIndex);
            if (!result.ok) throw Error(result.error);
            const returnUrl = cached&&context.loopOwner?context.loopOwner.sourceUrl:this.view.webContents.getURL();
            await navigate(result.data.href);
            // 详情里的字段相对于整页定位，不沿用列表页的条目下标。
            await visit(node.children || [], { ...context, list:{type:'css',selector:'body'},actionScope:pageScope(),loopOwner:null,detailTargets:null },depth+1);
            if (!this.stopped) {
              await navigate(returnUrl);
              if(context.loopOwner)restoreSourceScope(context);
              await this.exec('(x,y) => { window.scrollTo(x,y); return true; }', result.data.scrollX, result.data.scrollY);
            }
          } else if (node.type === 'next') {
            if (context.loop?.last) continue;
            // 空字符串表示已清除定位；旧任务未配置时仍继承任务规则。
            const selector = context.loop?.selector || (p.selector === '' ? null : p.selector ? { type: p.mode || 'css', selector: p.selector } : this.cfg.nextSel);
            const listNode=context.loop?.list;
            const pageCfg={...cfg,list:listNode||cfg.list};
            const before=await this.exec(pagecode.listFingerprintCode(),pageCfg);
            this.onLog('点击翻页，定位：'+(selector?JSON.stringify(selector):'自动识别'));
            const result = await this.exec(pagecode.clickNextCode(), selector);
            if(!result.ok && !['没有匹配指定的下一页元素','not found'].includes(result.error))throw Error(result.error);
            if (!result.ok || result.data?.ok === false) {
              if (context.loop) { context.loop.ended = true; this.onLog('未找到下一页，结束当前翻页循环'); }
              else throw Error(result.error || '未找到下一页');
            } else {
              if (result.data.mode === 'nav') {
                if (this.visited.has(result.data.href)) { if (context.loop) context.loop.ended = true; else throw Error('下一页地址重复'); }
                else { this.visited.add(result.data.href); await navigate(result.data.href); }
              } else await this.waitLoad((opts.loadTimeoutSec ?? 25) * 1000);
              const nextWait=Number(opts.nextWaitSec??1.2);
              this.onLog('翻页后等待 '+nextWait+' 秒');
              await this.wait(nextWait * 1000);
              if(!context.loop?.ended&&before.ok&&before.data.items.length){
                const deadline=this.now()+(opts.loadTimeoutSec??25)*1000;let changed=false;
                while(!this.stopped){
                  const after=await this.exec(pagecode.listFingerprintCode(),pageCfg);
                  if(after.ok&&after.data.items.length&&JSON.stringify(after.data.items)!==JSON.stringify(before.data.items)){changed=true;break;}
                  if(this.now()>=deadline)break;
                  await this.wait(Math.min(200,Math.max(0,deadline-this.now())));
                }
                if(!this.stopped&&!changed)throw Error('翻页后商品列表未更新，已停止以避免重复采集。请检查下一页按钮或页面验证状态');
                if(changed)this.onLog('已确认下一页商品内容更新');
              }
            }
          } else {
            if(node.type==='extract')await this.wait(Number(opts.beforeWaitSec??0)*1000);
            const result = await this.runAction(node,cfg,scope.itemIndex);
            if(!result.ok&&result.missing&&p.optional){this.onLog('元素未出现，跳过可选步骤：'+node.name);continue;}
            if (!result.ok) throw Error(result.error);
            if (node.type === 'extract') emitRows(result.data.rows,node);
            if (node.type === 'click') await this.waitLoad((opts.loadTimeoutSec ?? 25) * 1000);
          }
          if(p.after?.enabled)await this.wait(Number(p.after.seconds??1)*1000);
          if(!this.stopped&&await Retry.matches(this,p))throw Error('已命中重试条件');
        } catch (error) {
          if(this.stopped)return;
          if(error.fatal)throw Object.assign(Error(node.name+'：'+error.message),{fatal:true});
          const attempt=context.retry?.id===node.id?context.retry.attempt:0;
          const limit=p.retry?(p.retry.enabled&&Retry.atomicTypes.includes(node.type)?Number(p.retry.count??3):0):Number(p.retries||0);
          if(attempt<limit&&this.total===committedBefore) {
            this.onLog(node.name+' 重试 '+(attempt+1));
            if(p.retry?.enabled){await this.wait(Number(p.retry.intervalSec??5)*1000);if(this.stopped)return;await Retry.rotate(this,p,attempt+1);}
            if(this.stopped)return;
            await visit([node],{...context,retry:{id:node.id,attempt:attempt+1,openUrl}},depth);
          }
          else if(p.onError==='continue')this.onLog('跳过失败步骤：'+node.name+'：'+error.message);
          else throw Error(node.name + '：' + error.message);
        }
      }
    };
    const initialPopup=this.view.webContents?.__v6BlockPopups;
    try {
      Workflow.validate(this.cfg.flow);
      this.onProgress({ phase: 'start' });
      await visit(this.cfg.flow);
      await Retry.restore(this);if(this.view.webContents)this.view.webContents.__v6BlockPopups=initialPopup;
      this.onDone({ pages: this.pages || 1, totalRows: this.total, stopped: this.stopped,duplicates:this.duplicates,filtered:this.filtered,durationMs:this.elapsedMs() });
    } catch (error) {
      try{await Retry.restore(this);}catch(cleanupError){if(cleanupError!==error)error=Error(error.message+'；浏览器策略恢复失败：'+cleanupError.message);}
      if(this.view.webContents)this.view.webContents.__v6BlockPopups=initialPopup;
      this.onError(error.message);
    }
  }

  dedupe(rows) {
    const seen = this._seen || (this._seen = new Set());
    const out = [];
    for (const row of rows) {
      const key = JSON.stringify(row);
      if (seen.has(key)) {this.duplicates++;continue;}
      seen.add(key);
      out.push(row);
    }
    return out;
  }
}

module.exports = { Scraper };



