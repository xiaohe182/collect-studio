const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const pagecode=require('../engine/pagecode');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-input-')));
app.whenReady().then(async()=>{let server;const win=new BrowserWindow({show:false});try{
 server=http.createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(req.url.startsWith('/search')?'<main id="results">搜索结果</main>':'<form action="/search"><input id="q" name="q"><input id="city" name="city"><button>搜索</button></form>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;await win.loadURL(url);
 const wc=win.webContents;await wc.executeJavaScript(`window.__events=[];window.__v6={send:(type,payload)=>__events.push({type,payload})};(${pagecode.pickCode()})(true);document.querySelector('#q').click()`);
 assert.equal(await wc.executeJavaScript(`!!document.querySelector('[data-action="action-input"]')`),true,'input action offered');
 await wc.executeJavaScript(`document.querySelector('[data-action="action-input"]').click();document.querySelector('[data-input-value]').value='电摩';document.querySelector('#city').click()`);
 assert.equal(await wc.executeJavaScript(`document.querySelectorAll('[data-input-value]').length`),2,'combination retains draft');
 await wc.executeJavaScript(`document.querySelectorAll('[data-input-value]')[1].value='广州';document.querySelector('[data-input-enter]').checked=true;document.querySelector('[data-input-confirm]').click()`);
 const event=await wc.executeJavaScript(`__events.find(e=>e.type==='record-input')`);assert.equal(event.payload.entries[0].value,'电摩');assert.equal(event.payload.entries[1].value,'广州');assert.equal(event.payload.enter,true);
 await wc.executeJavaScript(`(${pagecode.pickCode()})(false)`);
 const {executeInput}=require('../engine/input-action');
 const result=await executeInput(wc,event.payload,{},null);assert.equal(result.ok,true);
 const end=Date.now()+5000;while(!wc.getURL().includes('/search')&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
 assert.equal(new URL(wc.getURL()).searchParams.get('q'),'电摩');assert.equal(new URL(wc.getURL()).searchParams.get('city'),'广州');
 console.log('PASS: select input, combined draft, native Enter submits form and retains both values');
 win.destroy();server.close();app.exit(0);
}catch(e){console.error(e);win.destroy();server?.close();app.exit(1);}});
