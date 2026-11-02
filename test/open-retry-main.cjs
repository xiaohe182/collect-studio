'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module'),http=require('node:http');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-opening-main-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),isolated=new Module(path.join(root,'engine/storage.js'));isolated.filename=path.join(root,'engine/storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);require('../main');
app.whenReady().then(async()=>{let server;try{
 server=http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<p>'+req.url+'</p>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 const win=BrowserWindow.getAllWindows()[0];if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));const invoke=(cmd,payload={})=>win.webContents.executeJavaScript('v6api.invoke('+JSON.stringify(cmd)+','+JSON.stringify(payload)+')');
 const identities=await invoke('browser-identities');assert.equal(identities.ok,true);assert.equal(identities.userAgents.length,2);assert.ok(identities.userAgents.every(x=>x.value.includes('Chrome/'+process.versions.chrome)));assert.match(identities.userAgents[1].value,/Android.*Mobile/);
 const editor=win.contentView.children[0].webContents;await editor.loadURL(url+'/editor');const editorUA=editor.getUserAgent();
 for(const blockPopups of [true,false]){
  const cfg={id:'popup-fixture',name:'popup fixture',url,allowNoExtract:true,fields:[],flow:[{id:'open',type:'open',name:'open',params:{url:url+'/start',blockPopups}},{id:'wait',type:'wait',name:'wait',params:{seconds:30}}]};assert.equal((await invoke('scrape-start',cfg)).ok,true);const wc=win.contentView.children[1].webContents;
  const deadline=Date.now()+5000;while(wc.getURL()!==url+'/start'||wc.isLoading()){if(Date.now()>deadline)throw Error('navigation timeout');await new Promise(r=>setTimeout(r,25));}
  await wc.executeJavaScript('window.open('+JSON.stringify(url+'/popup')+');true',true);await new Promise(r=>setTimeout(r,180));assert.equal(wc.getURL(),url+(blockPopups?'/start':'/popup'));
  await invoke('scrape-stop');while((await invoke('run-results')).summary?.running)await new Promise(r=>setTimeout(r,20));assert.equal(editor.getURL(),url+'/editor');assert.equal(editor.getUserAgent(),editorUA);
 }
 console.log('PASS browser identity IPC uses installed Chrome version; real execution window popup flag blocks/allows redirects and preserves editor');app.exit(0);
}catch(error){console.error(error);app.exit(1);}finally{server?.closeAllConnections();server?.close();}});
