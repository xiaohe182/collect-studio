'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Scraper}=require('../engine/orchestrator');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-proxy-policy-')));
app.whenReady().then(async()=>{
 let target,proxy,win;let proxied=[];
 try{
  target=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/json'?'application/json':'text/html');res.end(req.url==='/json'?JSON.stringify({state:'direct'}):'<p>direct</p>');});await new Promise(r=>target.listen(0,'127.0.0.1',r));
  proxy=http.createServer((req,res)=>{proxied.push({url:req.url,ua:req.headers['user-agent'],cookie:req.headers.cookie});res.setHeader('content-type',req.url.endsWith('/json')?'application/json':'text/html');res.end(req.url.endsWith('/json')?JSON.stringify({state:'proxied'}):'<p>proxied</p>');});await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+target.address().port,proxyURL='http://127.0.0.1:'+proxy.address().port;
  win=new BrowserWindow({show:false,webPreferences:{partition:'proxy-policy-'+Date.now()}});const wc=win.webContents;
  for(const jsonRequest of [false,true]){
   let error;const scraper=new Scraper({webContents:wc},{cfg:{fields:[],flow:[{id:'open',type:'open',name:'open',params:{url:base+(jsonRequest?'/json':'/page'),jsonRequest,cookieEnabled:true,cookieText:'fixture=secret',retry:{enabled:true,count:2,intervalSec:0,conditions:[{subject:'text',operator:'contains',value:'direct'}],rotateProxy:true,proxies:[proxyURL],rotateUserAgent:true,userAgents:['Proxy-Fixture-UA']}}}]},onError:e=>error=e});
   await scraper.run();assert.equal(error,undefined);assert.ok((await wc.executeJavaScript('document.body.innerText')).includes('proxied'));
   const request=proxied.find(r=>r.url===base+(jsonRequest?'/json':'/page'));assert.ok(request,'request must actually pass through configured HTTP proxy');assert.equal(request.ua,'Proxy-Fixture-UA');assert.ok(request.cookie.includes('fixture=secret'));
   const route=await wc.session.resolveProxy(base);assert.ok(!route.includes('127.0.0.1:'+proxy.address().port),'execution session must restore system proxy');
  }
  console.log('PASS actual Chromium navigation and session.fetch use configured HTTP proxy, Cookie and UA; system proxy restored after run');app.exit(0);
 }catch(error){console.error(error);app.exit(1);}finally{win?.destroy();target?.closeAllConnections();proxy?.closeAllConnections();target?.close();proxy?.close();}
});
