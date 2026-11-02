'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-stop-responsive-'));
app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),isolated=new Module(path.join(root,'engine/storage.js'));
isolated.filename=path.join(root,'engine/storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);
app.on('browser-window-created',(_e,w)=>{w.once('ready-to-show',()=>w.hide());});
require('../main');
app.whenReady().then(async()=>{let server;try{
  console.log('READY');
  server=require('node:http').createServer((_q,r)=>r.end('<p>local stop fixture</p>'));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const w=BrowserWindow.getAllWindows()[0];if(w.webContents.isLoading())await new Promise(r=>w.webContents.once('did-finish-load',r));
  const invoke=(cmd,payload={})=>w.webContents.executeJavaScript('v6api.invoke('+JSON.stringify(cmd)+','+JSON.stringify(payload)+')');
  const url='http://127.0.0.1:'+server.address().port;
  await w.contentView.children[0].webContents.loadURL(url);
  const cfg={id:'perf-stop',name:'停止响应测试',url,allowNoExtract:true,fields:[{name:'编号'}],opts:{},flow:[{id:'open',type:'open',name:'打开',params:{url}},{id:'wait',type:'wait',name:'等待',params:{seconds:30}}]};
  console.log('STARTING');assert.equal((await invoke('scrape-start',cfg)).ok,true);console.log('STARTED');
  const execution=w.contentView.children[1].webContents;
  await new Promise(r=>setTimeout(r,150));
  console.log('PREVIEW');await execution.executeJavaScript("window.__v6.send('collect-preview',{id:'partial',fields:[{name:'编号'}],rows:[{id:'a',values:['已采集-A']},{id:'b',values:['已采集-B']}]});true");
  for(let i=0;i<50&&(await invoke('run-results')).total<2;i++)await new Promise(r=>setTimeout(r,10));
  const execute=execution.executeJavaScript.bind(execution);
  execution.executeJavaScript=(code,...args)=>code.includes('__v6captureCollection')?new Promise(()=>{}):execute(code,...args);
  const started=performance.now(),result=await invoke('scrape-stop');
  const stopMs=performance.now()-started;
  assert.equal(result.ok,true);assert.ok(stopMs<250,'停止不应等待网页全表快照，实际 '+stopMs.toFixed(1)+'ms');
  for(let i=0;i<100&&(await invoke('run-results')).summary.running;i++)await new Promise(r=>setTimeout(r,20));
  const data=await invoke('run-results');assert.equal(data.summary.running,undefined);assert.equal(data.total,2);assert.deepEqual(data.rows,[['已采集-A'],['已采集-B']]);
  for(const command of ['scrape-pause','recovery-info','recovery-open','recovery-continue']){
    const removed=await invoke(command,{paused:true});assert.equal(removed.ok,false);assert.match(removed.error,/unknown cmd/);
  }
  assert.equal(fs.existsSync(path.join(storage.tasksDir(),'paused-run.json')),false);
  console.log('PASS stop returns in '+stopMs.toFixed(1)+'ms with a hung snapshot; collected rows retained; pause/recovery commands removed');
  server.close();app.exit(0);
}catch(error){console.error(error);server?.closeAllConnections();server?.close();app.exit(1);}});
