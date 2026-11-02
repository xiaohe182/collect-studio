const {app,BrowserWindow,webContents}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-table-resilience-ui-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),isolated=new Module(path.join(root,'engine/storage.js'));isolated.filename=path.join(root,'engine/storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);require('../main');
app.whenReady().then(async()=>{let server;try{
 let missing=false,serial=0;server=require('node:http').createServer((q,s)=>{const a=++serial*10,b=a+1;s.end('<table><thead><tr><th colid="c'+a+'">Name</th><th colid="c'+b+'">Code</th></tr></thead><tbody><tr rowid="one"><td colid="c'+a+'">A</td>'+(missing?'':'<td colid="c'+b+'">B</td>')+'</tr></tbody></table>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const run=s=>win.webContents.executeJavaScript(s),url='http://127.0.0.1:'+server.address().port;
 const wait=async fn=>{const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('timeout');};
 const editor=win.contentView.children[0].webContents;await editor.loadURL(url);
 await run('cfg={url:'+JSON.stringify(url)+',fields:[{name:"Name",rel:":scope"},{name:"Code",rel:"b"}],list:{type:"css",selector:"article"},flow:Workflow.defaults()};selectedNode=null;recognitionDraft={};generateRule();true');
 assert.equal(await run('cfg.fields.length'),2);assert.equal(await run('cfg.flow[1].children[0].children[0].params.fields.length'),2);
 await run('settingsDirty=false;cfg={url:'+JSON.stringify(url)+',fields:[],flow:[]};selectWholeTable("td")');
 await run('tableFieldsApply.click();selectNode(cfg.flow[0].id)');
 assert.equal(await run('listVirtualGrid.closest("label").hidden'),false);assert.equal(await run('listVirtualGrid.checked'),true);
 await run('listVirtualGrid.checked=false;captureNodeDraft()');assert.equal(await run('cfg.flow[0].params.list.scanHidden'),false);
 await run('listVirtualGrid.checked=true;captureNodeDraft()');assert.equal(await run('cfg.flow[0].params.list.scanHidden'),true);
 for(const enabled of [true,false]){
  await run('listVirtualGrid.checked='+enabled+';captureNodeDraft();selectWholeTable("td",cfg.flow[0].id)');
  await run('tableFieldsApply.click();selectNode(cfg.flow[0].id)');
  assert.equal(await run('listVirtualGrid.checked'),enabled);
  assert.equal(await run('cfg.flow[0].params.list.scanHidden'),enabled);
 }
 await run('listVirtualGrid.checked=true;captureNodeDraft();applyListSelection({...cfg.flow[0].params.list,scanHidden:undefined});selectNode(cfg.flow[0].id)');
 assert.equal(await run('listVirtualGrid.checked'),true);
 // Hidden test windows may lack a capture surface for the editor's modal backdrop.
 await run('if(messageDialog.open)messageDialog.close();true');
 await editor.executeJavaScript('document.body.classList.add("vxe-table");const th=document.createElement("th");th.className="col--checkbox";th.setAttribute("colid","old-checkbox");document.querySelector("thead tr").prepend(th);true');
 await run('const bad={name:"字段10",tableHeader:"",tableColumn:"colid:old-checkbox",type:"text",__on:true};cfg.fields.unshift(bad);if(cfg.flow[0].children[0].params.fields!==cfg.fields)cfg.flow[0].children[0].params.fields.unshift({...bad});true');
 const cfg=await run('({...cfg,opts:{scrollLoad:true,maxPages:1,maxScrollSec:10,scrollWait:0},flow:cfg.flow.map(n=>({...n,children:n.children.map(c=>({...c,params:{...c.params,before:{enabled:true,mode:"fixed",seconds:0}}}))}))})');
 missing=true;assert.equal((await run('cmd("scrape-start",'+JSON.stringify(cfg)+')')).ok,true);
 let state;await wait(async()=>{state=await run('cmd("run-results",{})');return !state.summary.running;});assert.ok(state.summary.error,'missing columns must stop with an explicit error');assert.equal(state.total,1);assert.deepEqual(state.rows,[['A','']]);
 assert.ok(!state.fields.some(f=>f.name==='字段10'));
 assert.equal(await run('cfg.fields.some(f=>f.name==="字段10")'),false);
 await run('if(messageDialog.open)messageDialog.close();true');
 missing=false;
 assert.equal((await run('cmd("scrape-start",'+JSON.stringify(cfg)+')')).ok,true);
 await wait(async()=>{state=await run('cmd("run-results",{})');return !state.summary.running;});assert.equal(state.summary.error,undefined);assert.deepEqual(state.rows,[['A','B']]);
 const waiting={id:'stop',name:'stop-control',url,allowNoExtract:true,fields:[],opts:{},flow:[{id:'wait',type:'wait',name:'wait',params:{seconds:30}}]};
 assert.equal((await run('cmd("scrape-start",'+JSON.stringify(waiting)+')')).ok,true);await new Promise(r=>setTimeout(r,150));
 const stopAt=Date.now();await run('btnResultStop.onclick()');
 await wait(async()=>{state=await run('cmd("run-results",{})');return !state.summary.running&&await run('!scraping');});assert.equal(state.summary.stopped,true);assert.ok(Date.now()-stopAt<2000);
 await new Promise(r=>setTimeout(r,200));assert.equal((await run('cmd("run-results",{})')).summary.running,undefined);
 console.log('PASS virtual-scrolling options; missing columns stop explicitly and preserve partial data; fresh rerun handles changed IDs; Stop cancels a wait without restarting collection');server.close();app.exit(0);
}catch(e){console.error(e);server?.close();app.exit(1);}});
