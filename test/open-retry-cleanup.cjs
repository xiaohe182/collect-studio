'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),http=require('node:http');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-proxy-cleanup-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),isolated=new Module(path.join(root,'engine/storage.js'));isolated.filename=path.join(root,'engine/storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);require('../main');
app.whenReady().then(async()=>{let server;try{
 server=http.createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<p>fixture</p>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const win=BrowserWindow.getAllWindows()[0];if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));
 const invoke=(cmd,payload={})=>win.webContents.executeJavaScript('v6api.invoke('+JSON.stringify(cmd)+','+JSON.stringify(payload)+')');
 const wait=async(fn,label,ms=3500)=>{const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,20));}throw Error(label+' timeout');};
 const editor=win.contentView.children[0].webContents;await editor.loadURL(url+'/editor');
 for(const fault of ['pendingTransition','setProxy','closeAllConnections']){
  const cfg={id:'cleanup-'+fault,name:'cleanup fault '+fault,url,allowNoExtract:true,fields:[{name:'value'}],flow:[{id:'open',type:'open',name:'open',params:{url,retry:{enabled:true,count:1,intervalSec:.2,conditions:[{subject:'text',operator:'contains',value:'fixture'}],rotateProxy:true,proxies:['http://127.0.0.1:9']}}}]};
  assert.equal((await invoke('scrape-start',cfg)).ok,true);const wc=win.contentView.children[1].webContents,ses=wc.session;let transitionStarted=false,restoreCalls=0,connectionCalls=0;
  const setProxy=ses.setProxy.bind(ses),closeAllConnections=ses.closeAllConnections.bind(ses);
  ses.setProxy=config=>{if(config.mode==='system')restoreCalls++;else transitionStarted=true;return fault==='pendingTransition'&&config.mode!=='system'||fault==='setProxy'&&config.mode==='system'?new Promise(()=>{}):Promise.resolve();};
  ses.closeAllConnections=()=>{connectionCalls++;return fault==='closeAllConnections'&&connectionCalls>1?new Promise(()=>{}):Promise.resolve();};
  await wait(()=>fault==='pendingTransition'?transitionStarted:fault==='setProxy'?restoreCalls>0:connectionCalls>1,'fault injection');
  await wc.executeJavaScript("window.__v6.send('collect-preview',{id:'partial',fields:[{name:'value'}],rows:[{id:'retained',values:['kept-'+"+JSON.stringify(fault)+"]}]});true");await wait(async()=>(await invoke('run-results')).total===1,'partial row');
  const started=Date.now();assert.equal((await invoke('scrape-stop')).ok,true);await wait(async()=>!(await invoke('run-results')).summary?.running,'Stop must finish pending proxy cleanup');
  assert.ok(Date.now()-started<3000);const result=await invoke('run-results');assert.match(result.summary.error,/代理.*恢复|浏览器策略恢复/);assert.deepEqual(result.rows,[['kept-'+fault]]);assert.equal(restoreCalls,fault==='pendingTransition'?0:1,'cleanup must not retry restoration or race an unfinished transition');assert.equal(result.summary.executionRetired,true);assert.equal(wc.isDestroyed(),true,'unsafe execution view must be retired');assert.equal((await invoke('run-page')).available,false);
  ses.setProxy=setProxy;ses.closeAllConnections=closeAllConnections;
  const next={id:'after-'+fault,name:'fresh run',url,allowNoExtract:true,fields:[],flow:[{id:'open',type:'open',name:'open',params:{url}}]};assert.equal((await invoke('scrape-start',next)).ok,true);const fresh=win.contentView.children[1].webContents;assert.notEqual(fresh.session,ses);await wait(async()=>!(await invoke('run-results')).summary?.running,'fresh run');assert.equal((await invoke('run-results')).summary.error,undefined);assert.equal(editor.getURL(),url+'/editor');
 }
 console.log('PASS Stop bounds pending setProxy(system) and closeAllConnections cleanup, retains rows, reports failure, retires unsafe session and accepts a fresh isolated run');app.exit(0);
}catch(error){console.error(error);app.exit(1);}finally{server?.closeAllConnections();server?.close();}});
