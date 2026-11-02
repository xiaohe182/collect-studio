const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Scraper}=require('../engine/orchestrator');
const {genericTable}=require('../engine/generic-table');
const pc=require('../engine/pagecode');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-engine-stop-')));
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{backgroundThrottling:false}});
 const exec=code=>w.webContents.executeJavaScript(code);
 const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const load=html=>w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
 const failures=[];
 const check=async(name,fn)=>{try{await fn();console.log('PASS',name);}catch(e){failures.push(name+': '+e.message);console.error('FAIL',name,e.message);}};
 try{
  await check('required missing target terminates and does not execute following nodes',async()=>{
   await load('<button id="after" onclick="window.afterClicked=true">after</button>');let error,done=false;
   const s=new Scraper(w,{cfg:{fields:[],flow:[{id:'missing',name:'required',type:'click',params:{selector:'#missing',mode:'css',timeout:.05}},{id:'after',name:'after',type:'click',params:{selector:'#after',mode:'css'}}]},onError:e=>error=e,onDone:()=>done=true});
   const running=s.run();const finished=await Promise.race([running.then(()=>true),sleep(600).then(()=>false)]);
   if(!finished){s.stop();await running;}
   assert.equal(finished,true,'required missing target must fail without waiting for user recovery');
   assert.match(error,/未匹配|超时/);assert.equal(done,false);assert.equal(await exec('!!window.afterClicked'),false);
  });
  await check('scroll limit returns partial values without a manual pause event',async()=>{
   await load('<div role="grid" aria-rowcount="101"><div role="row"><span role="columnheader" aria-colindex="1">Value</span></div><div id="sc" style="height:100px;width:200px;overflow:auto;position:relative"><div style="height:5000px"></div><div id="rows" style="position:absolute;top:0"></div></div></div><script>const sc=document.getElementById("sc");function render(){const start=Math.min(98,Math.floor(sc.scrollTop/50)),rows=document.getElementById("rows");rows.style.top=start*50+"px";rows.innerHTML=[start,start+1].map(i=>`<div role="row" aria-rowindex="${i+2}" style="height:50px"><span role="gridcell" aria-colindex="1">R${i}</span></div>`).join("");}sc.onscroll=render;render();</script>');
   const list={type:'xpath',selector:'//*[@role="row"][*[@role="gridcell"]]',genericGrid:true,tableRoot:'//*[@role="grid"]',headersPath:'//*[@role="columnheader"]'},fields=[{name:'Value',tableColumn:'aria-colindex:1',type:'text'}];
   await exec('window.limits=0;window.__v6={send:type=>{if(type==="collect-limit"){limits++;window.__v6collectPaused=false;}}};true');
   const result=await exec('('+genericTable.toString()+')('+JSON.stringify({list,fields})+',{maxScrollSec:.12,scrollWait:0,pauseAtScrollLimit:true})');
   assert.equal(result.reason,'达到滚动时间上限');assert.ok(result.rows.length>0&&result.rows.length<100);assert.equal(await exec('limits'),0);
   let error;const accepted=[];
   const s=new Scraper(w,{cfg:{list,fields,flow:[{id:'list',name:'list',type:'list',params:{list,timeout:1},children:[{id:'extract',name:'extract',type:'extract',params:{fields,dedupe:false}}]}]},opts:{maxScrollSec:.12,scrollWait:0},onRows:batch=>accepted.push(...batch),onError:e=>error=e});
   const running=s.run(),finished=await Promise.race([running.then(()=>true),sleep(1700).then(()=>false)]);if(!finished){s.stop();await running;}
   assert.equal(finished,true,'scroll timeout must complete');assert.match(error,/滚动.*上限|尚未确认/);assert.ok(accepted.length>0);
  });
  await check('stop flushes a current batch and keeps completed rows exactly once',async()=>{
   await exec('sc.scrollTop=0;render();window.__v6collectPaused=false;window.__v6={send:()=>{}};true');
   const list={type:'xpath',selector:'//*[@role="row"][*[@role="gridcell"]]',genericGrid:true,tableRoot:'//*[@role="grid"]',headersPath:'//*[@role="columnheader"]'},fields=[{name:'Value',tableColumn:'aria-colindex:1',type:'text'}];
   let s,summary;const accepted=[];
   const cfg={list,fields,flow:[{id:'first',name:'first',type:'extract',params:{fields,dedupe:false}},{id:'list',name:'list',type:'list',params:{list,timeout:1},children:[{id:'extract',name:'extract',type:'extract',params:{fields,dedupe:false}}]}]};
   s=new Scraper(w,{cfg,opts:{maxScrollSec:30,scrollWait:40},onRows:batch=>accepted.push(...batch),onDone:value=>summary=value,onError:e=>{throw Error(e);}});
   const running=s.run();await sleep(1000);const started=Date.now();s.stop();await running;
   assert.ok(Date.now()-started<700,'stop must be bounded');assert.ok(summary.stopped);assert.ok(accepted.length>2,'current page completion must deliver already harvested rows after stop');
   assert.deepEqual(accepted.slice(0,2),[['R0'],['R1']]);
   assert.equal(typeof s.setPaused,'undefined');assert.equal(typeof s.progressState,'undefined');
  });
  if(failures.length)throw Error(failures.join('\n'));
  app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});
