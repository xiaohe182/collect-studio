'use strict';
const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Scraper}=require('../engine/orchestrator');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-open-policy-')));
app.whenReady().then(async()=>{
 let server,win;const requests=[];
 try{
  server=http.createServer((req,res)=>{requests.push({url:req.url,cookie:req.headers.cookie,ua:req.headers['user-agent']});
   if(req.url==='/hang')return;
   if(req.url==='/big'){res.write('"');res.write('x'.repeat(2*1024*1024));res.end('"');return;}
   if(req.url==='/cache'){res.setHeader('cache-control','public, max-age=3600');res.end('<p>cached</p>');return;}
   if(req.url==='/json'){res.setHeader('content-type','application/json');res.end(JSON.stringify({html:'<script>window.bad=true</script>',cookie:req.headers.cookie||''}));return;}
   res.setHeader('content-type','text/html');res.end(req.url==='/list'?'<article><a href="/detail">link</a></article>':req.url==='/retry'&&requests.filter(r=>r.url==='/retry').length<2?'<p>retry-me</p>':'<p id="ok">done</p><iframe srcdoc="<b>frame retry</b>"></iframe><script>window.addEventListener("scroll",()=>window.scrolled=true)</script><div style="height:10000px"></div>');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;win=new BrowserWindow({show:false,webPreferences:{partition:'open-policy-'+Date.now(),backgroundThrottling:false}});const wc=win.webContents;
  let sequence=0;const open=p=>({id:'open'+(++sequence),type:'open',name:'open',params:{url:base+'/ok',...p}});
  async function run(flow,extra={}){let error,done;const s=new Scraper({webContents:wc},{cfg:{fields:[],flow,...extra},onError:e=>error=e,onDone:d=>done=d});await s.run();return {s,error,done};}
  await wc.loadURL(base+'/list');
  assert.equal((await run([{id:'list',type:'list',name:'list',params:{},children:[open({useLoopUrl:true})]}],{list:{type:'css',selector:'article'}})).error,undefined);assert.equal(wc.getURL(),base+'/detail');
  await wc.loadURL(base+'/list');assert.equal((await run([{id:'list',type:'list',name:'list',params:{},children:[open({useLoopUrl:true,loopUrlField:'href'})]}],{list:{type:'css',selector:'article'},fields:[{name:'href',rel:'a',type:'href',__on:false}]})).error,undefined);assert.equal(wc.getURL(),base+'/detail');
  await wc.session.cookies.set({url:base,name:'keep',value:'yes'});await wc.loadURL(base+'/ok');await wc.executeJavaScript('localStorage.keep="yes"');
  assert.equal((await run([open({jsonRequest:true,url:base+'/json',cookieEnabled:true,cookieText:'custom=secret',clearCache:true})])).error,undefined);
  assert.equal(requests.filter(r=>r.url==='/json').length,1);assert.ok(requests.find(r=>r.url==='/json').cookie.includes('custom=secret'));
  assert.equal(wc.__v6JsonUrl,base+'/json');assert.equal(await wc.executeJavaScript('window.bad'),undefined);assert.ok((await wc.executeJavaScript('document.body.innerText')).includes('<script>'));
  const {matches}=require('../engine/node-retry');assert.equal(await matches(new Scraper({webContents:wc},{cfg:{}}),{retry:{enabled:true,conditions:[{subject:'url',operator:'contains',value:'/json'}]}}),true);
  assert.equal((await wc.session.cookies.get({url:base,name:'keep'})).length,1);await wc.loadURL(base+'/ok');assert.equal(await wc.executeJavaScript('localStorage.keep'),'yes');
  await run([open({url:base+'/cache'})]);await run([open({})]);await run([open({url:base+'/cache'})]);assert.equal(requests.filter(r=>r.url==='/cache').length,1);await run([open({})]);await run([open({url:base+'/cache',clearCache:true})]);assert.equal(requests.filter(r=>r.url==='/cache').length,2,'HTTP cache must actually clear');
  assert.equal((await run([open({jsonRequest:true,url:base+'/json',cookieEnabled:true,cookieText:JSON.stringify([{name:'arrayCookie',value:'safe',domain:'outside.invalid',url:'https://outside.invalid/'}])})])).error,undefined);assert.ok(requests.filter(r=>r.url==='/json').at(-1).cookie.includes('arrayCookie=safe'));assert.equal((await wc.session.cookies.get({domain:'outside.invalid'})).length,0);
  assert.match((await run([open({jsonRequest:true,url:base+'/big'})])).error,/2 MiB/);
  let started=Date.now();assert.equal((await run([open({url:base+'/hang',timeout:.15,continueOnTimeout:true}),open({})])).error,undefined);assert.ok(Date.now()-started<2500);
  started=Date.now();assert.equal((await run([open({url:base+'/hang',jsonRequest:true,timeout:.15,continueOnTimeout:true}),open({})])).error,undefined);assert.ok(Date.now()-started<2500);
  const retry={enabled:true,count:2,intervalSec:.08,conditions:[{subject:'text',operator:'contains',value:'retry-me'}],rotateUserAgent:true,userAgents:['Fixture-UA/1'],rotateProxy:false,proxies:[]};
  const originalUA=wc.getUserAgent();started=Date.now();assert.equal((await run([open({url:base+'/retry',retry})])).error,undefined);assert.ok(Date.now()-started>=80);assert.equal(requests.filter(r=>r.url==='/retry').length,2);assert.equal(requests.filter(r=>r.url==='/retry')[1].ua,'Fixture-UA/1');assert.equal(wc.getUserAgent(),originalUA);
  const conditionScraper=new Scraper({webContents:wc},{cfg:{}});
  for(const condition of [{subject:'xpath',xpath:'//*[@id="ok"]',operator:'exists'},{subject:'xpath',xpath:'//*[@id="absent"]',operator:'missing'},{subject:'xpath',xpath:'//b',inFrame:true,frameXPath:'//iframe',operator:'contains',value:'frame retry'},{subject:'text',operator:'notContains',value:'absent'}])assert.equal(await matches(conditionScraper,{retry:{enabled:true,conditions:[condition]}}),true);
  let triesBefore=requests.length;const exhausted=await run([open({retry:{...retry,count:2,intervalSec:0,conditions:[{subject:'url',operator:'contains',value:'/ok'}]},onError:'continue'}),open({})]);assert.equal(exhausted.error,undefined);assert.equal(requests.slice(triesBefore).filter(r=>r.url==='/ok').length,4);
  assert.match((await run([open({retry:{...retry,conditions:[{subject:'text',operator:'contains',value:''}]}})])).error,/比较值/);
  await wc.loadURL(base+'/ok');const scrolled=await run([open({scrollAfter:true,scrollMaxSec:.15})]);assert.equal(scrolled.error,undefined);assert.ok(await wc.executeJavaScript('scrollY>0'));
  assert.match((await run([open({retry:{...retry,conditions:[{subject:'xpath',operator:'contains',value:'x',xpath:'//*['}]}})])).error,/XPath|定位/);
  const stop=new Scraper({webContents:wc},{cfg:{fields:[],flow:[open({url:base+'/hang',timeout:30})]}});started=Date.now();setTimeout(()=>stop.stop(),100);await stop.run();assert.ok(Date.now()-started<1500);
  const intervalStop=new Scraper({webContents:wc},{cfg:{fields:[],flow:[open({retry:{...retry,intervalSec:30,conditions:[{subject:'url',operator:'contains',value:'/ok'}]}})]}});started=Date.now();setTimeout(()=>intervalStop.stop(),120);await intervalStop.run();assert.ok(Date.now()-started<1500);
  const fetchStop=new Scraper({webContents:wc},{cfg:{fields:[],flow:[open({url:base+'/hang',jsonRequest:true,timeout:30})]}});started=Date.now();setTimeout(()=>fetchStop.stop(),100);await fetchStop.run();assert.ok(Date.now()-started<1500);
  const scrollStop=new Scraper({webContents:wc},{cfg:{fields:[],flow:[open({scrollAfter:true,scrollMaxSec:30})]}});started=Date.now();setTimeout(()=>scrollStop.stop(),150);await scrollStop.run();assert.ok(Date.now()-started<1500);
  assert.match((await run([open({retry:{...retry,rotateProxy:true,proxies:['http://user:secret@127.0.0.1:1234']}})])).error,/认证|credentials/);
  console.log('PASS real HTTP loop URLs, safe bounded JSON GET/cookies/cache, navigation timeout, conditional retries/UA restoration, invalid selectors/proxy credentials, Stop');
  app.exit(0);
 }catch(error){console.error(error);app.exit(1);}finally{win?.destroy();server?.closeAllConnections();server?.close();}
});
