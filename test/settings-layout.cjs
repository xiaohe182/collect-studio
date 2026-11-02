const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-align-')));require('../main');
app.whenReady().then(async()=>{try{
 const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const run=c=>win.webContents.executeJavaScript(c);
 const types=await run('Object.keys(Workflow.labels)');let checked=0;
 for(const [width,height] of [[1560,920],[1100,640]]){
  win.setSize(width,height);await new Promise(r=>setTimeout(r,200));
  for(const type of types){
   await run(`cfg={fields:[],flow:[Workflow.node(${JSON.stringify(type)})]};if(cfg.flow[0].type==='inputGroup')cfg.flow[0].params.entries=[{selector:'.query',value:'测试'}];selectNode(cfg.flow[0].id)`);
   const state=await run(`(()=>{const box=$('nodeSettings').getBoundingClientRect(),controls=[...$('nodeSettings').querySelectorAll('input,select,textarea,button')].filter(e=>e.getClientRects().length);const name=$('nodeName').getBoundingClientRect();return {overflow:controls.filter(e=>{const r=e.getBoundingClientRect();return r.left<box.left||r.right>box.right+1}).map(e=>e.outerHTML),checkboxes:[...$('nodeSettings').querySelectorAll('input[type=checkbox]')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().left-name.left),scroll:$('sidebar').scrollWidth-$('sidebar').clientWidth}})()`);
   assert.deepEqual(state.overflow,[],type);state.checkboxes.forEach(x=>assert.ok(Math.abs(x)<1,type+' checkbox alignment'));assert.ok(state.scroll<=1,type+' sidebar overflow');checked++;
   if(type==='pages')assert.equal(await run(`document.querySelector('[data-settings=pages] .node-apply').getBoundingClientRect().height`),24);
  }
  await run(`cfg.flow=[Workflow.node('extract')];selectNode(cfg.flow[0].id);new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  fs.mkdirSync(path.join(__dirname,'shots'),{recursive:true});fs.writeFileSync(path.join(__dirname,'shots','settings-aligned-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
  await run(`$('taskOptions').open=true;$('taskOptions').scrollIntoView({block:'start'})`);
  const positions=await run(`[...document.querySelectorAll('.setting-label input')].map(e=>({left:e.getBoundingClientRect().left,right:e.getBoundingClientRect().right}))`);
  assert.ok(positions.every(p=>p.left===positions[0].left&&p.right===positions[0].right),'advanced inputs aligned');
  fs.writeFileSync(path.join(__dirname,'shots','settings-advanced-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
  await run(`cfg.fields=[{name:'商品名称很长时也应保持整齐',type:'text',rel:'.title'}];editTrigger(cfg.flow[0]);new Promise(r=>setTimeout(r,150))`);
  const dialog=await run(`(()=>{const d=$('triggerDialog'),box=d.getBoundingClientRect();return {open:d.open,overflow:d.scrollWidth-d.clientWidth,outside:[...d.querySelectorAll('input,select,button')].some(e=>{const r=e.getBoundingClientRect();return r.left<box.left||r.right>box.right}),height:box.height,viewport:innerHeight}})()`);
  assert.ok(dialog.open&&!dialog.outside&&dialog.overflow<=1&&dialog.height<=dialog.viewport,'trigger dialog fits');
  fs.writeFileSync(path.join(__dirname,'shots','settings-dialog-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
  await run(`$('triggerDialog').close();$('taskOptions').open=false;document.querySelector('[data-tab=basic]').click();document.querySelector('.side-scroll').scrollTop=0`);
 }
 console.log('PASS: '+checked+' node/viewport combinations, controls within sidebar, all checkboxes aligned with input column');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
