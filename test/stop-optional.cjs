const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),http=require('node:http');
const {Scraper}=require('../engine/orchestrator');
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false});let server;try{
 await win.loadURL('data:text/html,<button onclick="this.textContent=\'clicked\'">cover</button>');
 for(const selector of ['//button','//button[@id="absent"]']){
  let error;const logs=[];
  const scraper=new Scraper(win,{cfg:{fields:[],flow:[{id:'optional',name:'覆盖',type:'click',params:{selector,mode:'xpath',optional:true}}]},onError:e=>error=e,onLog:s=>logs.push(s)});
  await scraper.run();assert.equal(error,undefined);
  if(selector.includes('absent'))assert.ok(logs.some(s=>s.includes('跳过可选步骤')));
 }
 assert.equal(await win.webContents.executeJavaScript('document.querySelector("button").textContent'),'clicked');
 server=http.createServer(()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 let error,done;const scraper=new Scraper(win,{cfg:{fields:[],flow:[{id:'open',type:'open',name:'打开网页',params:{url:'http://127.0.0.1:'+server.address().port,timeout:120}}]},onError:e=>error=e,onDone:r=>done=r});
 const start=Date.now(),running=scraper.run();setTimeout(()=>scraper.stop(),200);await running;
 assert.equal(error,undefined);assert.equal(done.stopped,true);assert.ok(Date.now()-start<2000);
 console.log('PASS: optional XPath click present/absent; stop interrupts hanging navigation in under 2 seconds');app.exit(0);
}catch(e){console.error(e);app.exit(1);}finally{server?.closeAllConnections();server?.close();}});
