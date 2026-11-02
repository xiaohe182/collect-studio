const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-insert-')));require('../main');
app.whenReady().then(async()=>{try{
 const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const run=c=>win.webContents.executeJavaScript(c);
 await run(`cfg={fields:[],flow:[Workflow.node('open'),Workflow.node('repeat')]};selectNode(cfg.flow[0].id)`);
 assert.equal(await run(`document.querySelectorAll('.flow-insert').length`),4);
 async function insert(owner,index,type){await run(`document.querySelector('.flow-insert[data-owner="${owner}"][data-index="${index}"]').click();document.querySelector('[data-insert-type="${type}"]').click()`);}
 await insert('',1,'wait');assert.deepEqual(await run('cfg.flow.map(n=>n.type)'),['open','wait','repeat']);
 const owner=await run('cfg.flow[2].id');await insert(owner,0,'input');assert.equal(await run('cfg.flow[2].children[0].type'),'input');
 await insert(owner,0,'click');assert.deepEqual(await run('cfg.flow[2].children.map(n=>n.type)'),['click','input']);
 await run('undoNode()');assert.deepEqual(await run('cfg.flow[2].children.map(n=>n.type)'),['input']);
 await insert('',0,'hover');await insert('',4,'extract');assert.deepEqual(await run('cfg.flow.map(n=>n.type)'),['hover','open','wait','repeat','extract']);
 await run("selectNode(cfg.flow[1].id);document.querySelector('#tab-adv input[type=checkbox]').click()");
 assert.equal(await run('settingsDirty'),true);
 await run("selectNode(cfg.flow[2].id)");assert.equal(await run('cfg.flow[1].params.before.enabled'),true);
 const removed=await run('selectedNode');await run('deleteNode()');assert.equal(await run('!!Workflow.find(cfg.flow,'+JSON.stringify(removed)+')'),false);assert.equal(await run("!!document.querySelector('[data-id='+"+JSON.stringify(removed)+"+']')"),false);
 assert.equal(await run("$('btnSaveRule').disabled"),true);
 await insert('',1,'click');assert.equal(await run('currentNode().type'),'click');
 await run(`document.querySelector('.flow-insert').click()`);
 assert.equal(await run(`document.querySelectorAll('[data-insert-type]').length===Object.keys(Workflow.labels).length`),true);
 assert.equal(await run(`(()=>{const r=$('nodeContext').getBoundingClientRect();return r.left>=$('sidebar').getBoundingClientRect().left&&r.bottom<=innerHeight})()`),true);
 await run(`$('nodeContext').hidden=true;scraping=true;renderFlow()`);assert.equal(await run(`[...document.querySelectorAll('.flow-insert')].every(b=>b.disabled)`),true);
 await run(`scraping=false;renderFlow()`);await run(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
 fs.mkdirSync(path.join(__dirname,'shots'),{recursive:true});fs.writeFileSync(path.join(__dirname,'shots','flow-insert.png'),(await win.webContents.capturePage()).toPNG());
 console.log('PASS: insert at start/middle/end, nested empty loop and before child, undo, all node types, menu bounds, run lock');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
