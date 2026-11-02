const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-message-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),Module=require('node:module'),isolated=new Module(path.join(root,'engine','storage.js'));isolated.filename=path.join(root,'engine','storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);require('../main');
app.whenReady().then(async()=>{let server;try{
const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const run=c=>win.webContents.executeJavaScript(c);
server=require('node:http').createServer((req,res)=>{res.setHeader('content-type','text/html');if(req.url==='/login'){res.writeHead(302,{Location:'/tsHome'});res.end();}else res.end('<input id="value">');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
const initialPage=win.contentView.children.find(v=>v.webContents).webContents;await initialPage.loadURL(url+'/tsHome');
await run(`cfg={list:null,fields:[],url:${JSON.stringify(url+'/login')},flow:[{id:'open',type:'open',name:'打开',params:{url:${JSON.stringify(url+'/login')}}},{id:'login',type:'condition',name:'登录分支',params:{operator:'urlContains',value:'/login'},children:[{id:'bad',type:'click',name:'不应执行',params:{selector:'#missing',mode:'css'}}]},{id:'home',type:'condition',name:'首页分支',params:{operator:'urlEquals',value:${JSON.stringify(url+'/tsHome')}},children:[{id:'input',type:'input',name:'输入',params:{selector:'#value',mode:'css',value:'passed'}}]}]};$('urlInput').value=cfg.url;startScrape()`);
const end=Date.now()+10000;while(await run('scraping')){if(Date.now()>end)throw Error('timeout');await new Promise(r=>setTimeout(r,100));}
console.log(await run(`$('log').textContent`));
assert.equal(await run(`$('resultsDialog').open && !$('messageDialog').open`),true);
const page=win.contentView.children.find(v=>v.webContents).webContents;
assert.equal(await page.executeJavaScript(`document.querySelector('#value').value`),'passed');
assert.equal(await run(`$('progressFill').style.width`),'100%');
console.log('PASS: redirect /login to /tsHome, skip login branch, match exact actual URL, action-only task opens results and completes');app.exit(0);
}catch(e){console.error(e);app.exit(1);}finally{server?.close();}});


