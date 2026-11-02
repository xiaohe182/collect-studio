const {app,BrowserWindow,dialog}=require('electron'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-delete-'));app.setPath('userData',path.join(root,'profile'));const storage=require('../engine/storage'),Module=require('module'),m=new Module(path.join(root,'engine/storage.js'));m.filename=path.join(root,'engine/storage.js');m._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),m.filename);Object.assign(storage,m.exports);for(const id of ['active','old1','old2'])storage.saveTask({id,name:id,url:'https://example.com',flow:[],fields:[]});let answer=0;dialog.showMessageBox=async()=>({response:answer});require('../main');
app.whenReady().then(async()=>{let server;try{
 server=require('http').createServer((req,res)=>res.end('<html><body style="margin:0;background:#eef5ff;font:24px sans-serif"><header style="background:#1878ff;color:white;padding:20px">Browser page full width</header><div style="height:1500px;background:linear-gradient(#eef5ff,#aabbdd)">Viewport stays fixed when bottom data panel opens</div></body></html>'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const w=BrowserWindow.getAllWindows()[0];await new Promise(r=>w.webContents.once('did-finish-load',r));const run=s=>w.webContents.executeJavaScript(s),url='http://127.0.0.1:'+server.address().port;
 const cfg={id:'active',url,name:'layout',allowNoExtract:true,fields:[],viewport:{width:1560,height:936},flow:[{id:'open',type:'open',params:{url}},{id:'wait',type:'wait',params:{seconds:20}}]};
 assert.equal((await run("cmd('scrape-start',"+JSON.stringify(cfg)+")")).ok,true);
 await new Promise(r=>setTimeout(r,200));await run("openPanelDialog('resultsDialog')");await run('btnShowRunPage.onclick()');await new Promise(r=>setTimeout(r,100));
 assert.ok(await run('resultsDialog.classList.contains("run-bottom-collapsed")'));
 const target=require('electron').webContents.getAllWebContents().find(c=>c.getURL().startsWith(url));const before=JSON.parse(target.runMetricsKey);
 await run('btnToggleRunBottom.onclick()');await new Promise(r=>setTimeout(r,100));const after=JSON.parse(target.runMetricsKey);
 assert.equal(before.scale,after.scale);assert.equal(before.width,after.width);assert.equal(before.height,after.height);
 assert.ok(Math.abs(after.scale*after.width-(await run('runPageSlot.getBoundingClientRect().width')))<1);
 fs.mkdirSync(path.join(__dirname,'shots'),{recursive:true});fs.writeFileSync(path.join(__dirname,'shots','run-page-overlay.png'),(await w.webContents.capturePage()).toPNG());
 await run("cmd('scrape-stop',{})");console.log('PASS show webpage starts collapsed; opening results clips presentation without changing scale or layout; width filled');server.close();app.exit(0);
}catch(e){console.error(e);server?.close();app.exit(1);}});
