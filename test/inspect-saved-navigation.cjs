const {app,BrowserWindow}=require('electron'),fs=require('fs'),path=require('path'),os=require('os');
const {Scraper}=require('../engine/orchestrator');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-navigation-check-')));
app.whenReady().then(async()=>{try{
 const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,'../tasks/a69c014c-b197-4d47-9478-a145125e58bb.json'),'utf8'));
 cfg.flow=cfg.flow.slice(0,cfg.flow.findIndex(n=>n.name==='分页器')+1);
 const w=new BrowserWindow({show:false,width:cfg.viewport.width,height:cfg.viewport.height,webPreferences:{backgroundThrottling:false}});
 w.webContents.setWindowOpenHandler(({url})=>{console.log('new-window',url.split('?')[0]);w.loadURL(url).catch(()=>{});return {action:'deny'};});
 const events=[];w.webContents.on('did-navigate-in-page',(_,url)=>events.push({navigation:url.split('?')[0]}));
 const scraper=new Scraper(w,{cfg,opts:cfg.opts,onLog:message=>{if(!/手机号|密码|验证码/.test(message))events.push({message});},onError:error=>events.push({error})});
 await scraper.run();
 const state=await w.webContents.executeJavaScript(`({url:location.href,title:document.title,inputs:[...document.querySelectorAll('input')].map(e=>({placeholder:e.placeholder,type:e.type,visible:!!e.getClientRects().length})),frames:[...document.querySelectorAll('iframe')].map(e=>({src:e.src})),sampleLinks:[...document.querySelectorAll('a')].filter(e=>e.textContent.trim()==='样品资料').map(e=>({href:e.getAttribute('href'),target:e.target,visible:!!e.getClientRects().length})),tables:document.querySelectorAll('table,[role=grid]').length})`);
 fs.mkdirSync(path.join(__dirname,'../output'),{recursive:true});
 fs.writeFileSync(path.join(__dirname,'../output/navigation-diagnostic.json'),JSON.stringify({events,state},null,2));
 console.log(JSON.stringify({events,state}));app.exit(0);
}catch(e){console.error(e.message);app.exit(1);}});
