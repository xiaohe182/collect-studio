const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Scraper}=require('../engine/orchestrator'),W=require('../engine/workflow');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-node-options-')));require('../main');
app.whenReady().then(async()=>{try{
 const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const run=code=>win.webContents.executeJavaScript(code);
 const errors=[];win.webContents.on('console-message',(_,level,message)=>{if(level>=3)errors.push(message);});
 await run(`cfg={fields:[],flow:[Workflow.node('pages'),Workflow.node('wait')]};cfg.flow[0].children=[Workflow.node('list'),Workflow.node('next')];selectNode(cfg.flow[0].id)`);
 assert.equal(await run(`$('nodeSettings').parentElement.id`),'tab-basic');
 assert.equal(await run(`$('optPages').closest('details').id`),'taskOptions');
 await run(`(()=>{const h=document.querySelector('[data-settings=pages]'),loc=h.querySelector('input[type=text]');loc.value='//button[@id="next"]';loc.onchange();const checks=h.querySelectorAll('input[type=checkbox]');checks[1].checked=true;checks[1].onchange();const count=h.querySelector('input[type=number]');count.value=2;count.onchange();h.querySelector('.node-apply').click();})()`);
 assert.equal(await run('cfg.flow[0].params.count'),2);
 await run(`document.querySelector('[data-tab=adv]').click();(()=>{const h=$('tab-adv'),enabled=h.querySelector('input[type=checkbox]');enabled.checked=true;enabled.onchange();const mode=h.querySelector('select');mode.value='fixed';mode.onchange();const seconds=h.querySelector('input[type=number]');seconds.value='0';seconds.onchange();const checks=h.querySelectorAll('input[type=checkbox]');checks[1].checked=true;checks[1].onchange();const xpath=h.querySelector('input[type=text]');xpath.value='//article';xpath.onchange();h.querySelector('.node-apply').click();})()`);
 assert.equal(await run('cfg.flow[0].params.before.xpath'),'//article');
 await run(`const draftSeconds=$('tab-adv').querySelector('input[type=number]');draftSeconds.value=7;draftSeconds.onchange()`);
 assert.equal(await run('cfg.flow[0].params.before.seconds'),0,'unapplied edits must not mutate saved params');
 await run(`selectNode(cfg.flow[1].id)`);assert.equal(await run(`$('tab-adv').querySelector('input[type=checkbox]').checked`),false);
 await run(`selectNode(cfg.flow[0].id)`);assert.equal(await run(`$('tab-adv').querySelector('input[type=checkbox]').checked`),true);
 await run(`cfg.url='https://example.com';$('urlInput').value=cfg.url;$('taskName').value='节点设置回归';$('btnSaveRule').click();new Promise(r=>setTimeout(r,300))`);
 assert.match(await run(`$('notice').textContent`),/已保存/);
 for(const [width,height] of [[1100,700],[1560,920]]){
  win.setSize(width,height);await new Promise(r=>setTimeout(r,100));
  for(const tab of ['basic','adv']){
   await run(`document.querySelector('[data-tab=${tab}]').click();new Promise(r=>setTimeout(r,150))`);
   assert.ok(await run(`$('sidebar').scrollWidth<=$('sidebar').clientWidth+1`));
   fs.writeFileSync(path.join(__dirname,'shots',`node-pages-${tab}-${width}.png`),(await win.webContents.capturePage()).toPNG());
  }
 }
 assert.deepEqual(errors,[]);
 const target=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});
 await target.loadURL('data:text/html,<body><article>first</article><button id="next" onclick="document.querySelector(\'article\').textContent=\'second\'">next</button><iframe srcdoc="<body><span>ready</span></body>"></iframe>');
 const pages=W.node('pages');pages.params={limitEnabled:true,count:2,mode:'xpath',selector:'//button[@id="next"]',before:{enabled:true,mode:'fixed',seconds:0,waitElement:true,xpath:'//span',inFrame:true,frameXPath:'//iframe',timeout:2}};
 const list=W.node('list');list.children=[W.node('extract')];const next=W.node('next');next.params.selector='#wrong-child-selector';pages.children=[list,next];
 let rows=[],error;const scraper=new Scraper(target,{cfg:{flow:[pages],list:{type:'css',selector:'article'},fields:[{name:'text',type:'text',rel:':scope'}]},opts:{scrollLoad:false,autoNext:false,nextWaitSec:0},onRows:r=>rows.push(...r),onError:e=>error=e});
 await scraper.run();assert.equal(error,undefined);assert.deepEqual(rows,[['first'],['second']]);
 await target.webContents.executeJavaScript(`setTimeout(()=>{let e=document.createElement('strong');document.body.append(e)},300)`);
 const waiting={name:'wait',params:{before:{enabled:true,mode:'fixed',seconds:0,waitElement:true,xpath:'//strong',timeout:2}}};
 const start=Date.now();await scraper.beforeNode(waiting);assert.ok(Date.now()-start>=200);
 waiting.params.before.xpath='//missing';waiting.params.before.timeout=1;await assert.rejects(scraper.beforeNode(waiting),/超时/);
 waiting.params.before.xpath='[';await assert.rejects(scraper.beforeNode(waiting),/定位失败/);
 const stopped=new Scraper(target,{cfg:{}});const pending=stopped.beforeNode({name:'stop',params:{before:{enabled:true,mode:'fixed',seconds:20}}});setTimeout(()=>stopped.stop(),100);const stopStart=Date.now();await pending;assert.ok(Date.now()-stopStart<1000);
 console.log('PASS: node tabs, conditional controls, apply/save, node isolation, 2 viewports; parent pagination XPath and limit, iframe wait, delayed element, timeout, invalid XPath and stop');app.exit(0);
}catch(error){console.error(error);app.exit(1);}});
