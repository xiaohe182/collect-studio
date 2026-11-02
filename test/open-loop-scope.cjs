'use strict';
const path=require('node:path'),fs=require('node:fs'),os=require('node:os');
if(!process.versions.electron){
 const {spawn}=require('node:child_process'),env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(path.resolve(__dirname,'../node_modules/electron/dist/electron.exe'),[__filename],{env,windowsHide:true,stdio:'inherit'});
 const timer=setTimeout(()=>child.kill(),60000);child.on('exit',code=>{clearTimeout(timer);process.exitCode=code??1;});return;
}
const {app,BrowserWindow}=require('electron'),http=require('node:http'),assert=require('node:assert/strict');
const {Scraper}=require('../engine/orchestrator');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-loop-scope-')));
app.whenReady().then(async()=>{
 let server,win;const hits=[],counts=new Map();let failures=0,passed=0;
 const node=(type,params={},children)=>({id:'n'+(++node.id),type,name:type,params,children});node.id=0;
 const list=(children,selector='article')=>node('list',{list:{type:'css',selector},timeout:0},children);
 const open=p=>node('open',{useLoopUrl:true,...p});
 const extract=(rel='h1',extra={})=>node('extract',{fields:[{name:'value',type:'text',rel}],...extra});
 const retry={enabled:true,count:1,intervalSec:0,conditions:[]};
 try{
  server=http.createServer((req,res)=>{
   const url=req.url;hits.push(url);counts.set(url,(counts.get(url)||0)+1);res.setHeader('content-type','text/html; charset=utf-8');res.setHeader('cache-control','no-store');
   if(url==='/direct')return res.end('<article><a href="/detail/1">one</a></article><article><a href="/detail/2">two</a></article>');
   if(url==='/back-list')return res.end('<article><a href="/plain">plain</a></article><article><a href="/detail/2">two</a></article>');
   if(url==='/self')return res.end('<a class="item" href="/detail/1">one</a><a class="item" href="/detail/2">two</a>');
   if(url==='/source/fields')return res.end('<article><i>../detail/1</i></article><article><i>../detail/2</i></article>');
   if(url==='/json-list')return res.end('<article><a href="/json/1">one</a></article><article><a href="/json/2">two</a></article>');
   if(url.startsWith('/json/')){res.setHeader('content-type','application/json');return res.end(counts.get(url)===1?'invalid JSON':JSON.stringify({value:url}));}
   if(url==='/nested')return res.end([1,2].map(i=>`<article><a href="/group/${i}">group</a><i>/end/${i}</i></article>`).join(''));
   if(url.startsWith('/group/')){const id=url.split('/').pop();return res.end(['a','b'].map(i=>`<section><a href="/leaf/${id+i}">${i}</a></section>`).join(''));}
   if(url==='/invalid')return res.end('<article><a href="/detail/1">one</a></article><article><a href="javascript:void(0)">bad</a></article><article><a href="/detail/2">two</a></article>');
   if(url==='/plain')return res.end('<article>one</article><article>two</article>');
   if(url.startsWith('/detail/'))return res.end(`<h1>${url}</h1><input id="input"><select id="select"><option value="a">a</option><option value="b">b</option></select><button id="hover" onmouseover="this.dataset.done='yes'">hover</button><button id="click" onclick="document.querySelector('#out').textContent=document.querySelector('#input').value+'|'+document.querySelector('#select').value+'|'+document.querySelector('#hover').dataset.done">click</button><div id="out"></div><article><a href="/wrong">decoy</a></article>`);
   res.end(`<h1>${url}</h1>`);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port;win=new BrowserWindow({show:false,webPreferences:{partition:'scope-'+Date.now(),backgroundThrottling:false}});const wc=win.webContents;
  async function run(source,flow,fields=[],options={}){
   hits.length=0;await wc.loadURL(base+source);const rows=[],logs=[];let error,done,snapshots=0;
   const s=new Scraper(win,{cfg:{flow,list:{type:'css',selector:'article'},fields},opts:{loadTimeoutSec:.3,scrollLoad:false},onRows:r=>rows.push(...r),onError:e=>error=e,onDone:d=>done=d,onLog:l=>logs.push(l)});
   const exec=s.exec.bind(s);s.exec=async(code,...args)=>{if(code.includes('function v6LoopUrls('))snapshots++;return exec(code,...args);};
   if(options.stopAfterCapture){s.exec=async(code,...args)=>{const result=await exec(code,...args);if(code.includes('function v6LoopUrls('))s.stop();return result;};}
   await s.run();return {rows,error,done,logs,snapshots};
  }
  async function check(name,fn){try{await fn();passed++;console.log('PASS '+name);}catch(e){failures++;console.error('FAIL '+name+': '+e.message);}}
  const assertOk=r=>assert.equal(r.error,undefined);
  await check('child links: two targets, destination input/select/hover/click/condition and explicit extraction list',async()=>{
   const children=[open(),node('input',{selector:'#input',value:'first'}),node('inputGroup',{entries:[{selector:'#input',value:'typed'}]}),node('select',{selector:'#select',value:'b'}),node('hover',{selector:'#hover'}),node('click',{selector:'#click'}),node('condition',{selector:'#out',operator:'contains',value:'typed|b|yes'},[extract(':scope',{list:{type:'css',selector:'h1'}})])];
   const r=await run('/direct',[list(children)]);assertOk(r);assert.deepEqual(r.rows,[['/detail/1'],['/detail/2']]);assert.deepEqual(hits,['/direct','/detail/1','/detail/2']);assert.equal(r.snapshots,1);
  });
  await check('current-item anchors and destination page extraction',async()=>{const r=await run('/self',[list([open(),extract()],'.item')]);assertOk(r);assert.deepEqual(r.rows,[['/detail/1'],['/detail/2']]);});
  await check('disabled named URL field resolves both relative values against captured source base',async()=>{const r=await run('/source/fields',[list([open({loopUrlField:'url'}),extract()])],[{name:'url',rel:'i',type:'text',__on:false}]);assertOk(r);assert.deepEqual(r.rows,[['/detail/1'],['/detail/2']]);assert.deepEqual(hits,['/source/fields','/detail/1','/detail/2']);assert.equal(r.snapshots,1);});
  await check('first attempt fails: recursive JSON retry keeps item URL and updates following sibling scope',async()=>{const r=await run('/json-list',[list([open({jsonRequest:true,retry}),extract('pre')])]);assertOk(r);assert.deepEqual(r.rows.map(row=>JSON.parse(row[0]).value),['/json/1','/json/2']);assert.deepEqual(hits,['/json-list','/json/1','/json/1','/json/2','/json/2']);assert.equal(r.logs.filter(x=>x.includes('重试 1')).length,2);});
  await check('nested snapshots and outer node-specific URL survive inner list navigation',async()=>{
   const r=await run('/nested',[list([node('condition',{operator:'urlContains',value:'/'},[open()]),list([open(),extract()],'section'),open({loopUrlField:'end'}),extract()])],[{name:'end',rel:'i',type:'text',__on:false}]);
   assertOk(r);assert.deepEqual(r.rows,[['/leaf/1a'],['/leaf/1b'],['/end/1'],['/leaf/2a'],['/leaf/2b'],['/end/2']]);assert.deepEqual(hits,['/nested','/group/1','/leaf/1a','/leaf/1b','/end/1','/group/2','/leaf/2a','/leaf/2b','/end/2']);assert.equal(r.snapshots,3);
  });
  await check('explicit back re-establishes owning source item',async()=>{const r=await run('/direct',[list([open(),extract(),node('back'),extract('a')])]);assertOk(r);assert.deepEqual(r.rows,[['/detail/1'],['one'],['/detail/2'],['two']]);assert.equal(wc.getURL(),base+'/direct');});
  await check('detail boundary creates independent inner snapshots and returns source scope',async()=>{
   const r=await run('/nested',[list([node('detail',{selector:'a',relative:true},[list([open(),extract()],'section')]),extract('a',{dedupe:false}),open({loopUrlField:'end'}),extract()])],[{name:'end',rel:'i',type:'text',__on:false}]);
   assertOk(r);assert.deepEqual(r.rows,[['/leaf/1a'],['/leaf/1b'],['group'],['/end/1'],['/leaf/2a'],['/leaf/2b'],['group'],['/end/2']]);assert.equal(r.snapshots,3);
  });
  await check('invalid item follows open continue policy and later targets still open',async()=>{const r=await run('/invalid',[list([open({onError:'continue'})])]);assertOk(r);assert.deepEqual(hits,['/invalid','/detail/1','/detail/2']);assert.equal(r.logs.filter(x=>x.includes('跳过失败步骤：open')).length,1);});
  await check('invalid item stop policy retains committed rows without loop replay',async()=>{const root=list([open(),extract()]);root.params.retries=2;const r=await run('/invalid',[root]);assert.match(r.error,/http|https/);assert.deepEqual(r.rows,[['/detail/1']]);assert.deepEqual(hits,['/invalid','/detail/1']);});
  await check('unknown URL field is handled per open node without fallback navigation',async()=>{const r=await run('/direct',[list([open({loopUrlField:'missing',onError:'continue'}),extract('a')])]);assertOk(r);assert.deepEqual(r.rows,[['one'],['two']]);assert.deepEqual(hits,['/direct']);assert.equal(r.logs.filter(x=>x.includes('循环网址字段不存在：missing')).length,2);});
  await check('fixed URL open retains configured list for ordinary top-level extraction',async()=>{const r=await run('/self',[node('open',{url:base+'/plain'}),extract(':scope')]);assertOk(r);assert.deepEqual(r.rows,[['one'],['two']]);});
  await check('top-level back preserves the configured extraction list',async()=>{const r=await run('/plain',[node('open',{url:base+'/self'}),node('back'),extract(':scope')]);assertOk(r);assert.deepEqual(r.rows,[['one'],['two']]);});
  await check('dynamic loop then top-level fixed open restores configured list inheritance',async()=>{const r=await run('/direct',[list([open()]),node('open',{url:base+'/plain'}),extract(':scope')]);assertOk(r);assert.deepEqual(r.rows,[['one'],['two']]);assert.deepEqual(hits,['/direct','/detail/1','/detail/2','/plain']);});
  await check('dynamic loop then top-level back restores configured list inheritance',async()=>{const r=await run('/back-list',[list([open()]),node('back'),extract(':scope')]);assertOk(r);assert.deepEqual(r.rows,[['one'],['two']]);assert.equal(wc.getURL(),base+'/plain');});
  await check('ownerless detail children preserve body inheritance across fixed open and back',async()=>{const r=await run('/direct',[list([node('detail',{selector:'a',relative:true},[node('open',{url:base+'/plain'}),extract('article',{dedupe:false}),node('back'),extract()])])]);assertOk(r);assert.deepEqual(r.rows,[['one'],['/detail/1'],['one'],['/detail/2']]);});
  await check('normal list extraction fast path',async()=>{const r=await run('/plain',[list([extract(':scope')])]);assertOk(r);assert.deepEqual(r.rows,[['one'],['two']]);assert.equal(r.snapshots,0);});
  await check('stop after batched capture prevents all destination requests',async()=>{const r=await run('/direct',[list([open(),extract()])],[],{stopAfterCapture:true});assertOk(r);assert.equal(r.done.stopped,true);assert.deepEqual(hits,['/direct']);});
  console.log(`RESULT ${passed} passed, ${failures} failed`);app.exit(failures?1:0);
 }catch(e){console.error(e);app.exit(1);}finally{win?.destroy();server?.closeAllConnections();server?.close();}
});
