const assert=require('node:assert/strict');
const {Scraper}=require('../engine/orchestrator');
async function scenario(opts,params={limitEnabled:false}){
  let actions=0,error;const waits=[];
  const s=new Scraper({webContents:{isLoading:()=>false,getURL:()=>''}},{cfg:{fields:[],flow:[{id:'pages',type:'pages',name:'pages',params,children:[{id:'item',type:'extract',name:'extract',params:{}},{id:'next',type:'next',name:'next',params:{}}]}]},opts,onError:e=>error=e});
  s.wait=async ms=>waits.push(ms);
  s.runAction=async()=>{actions++;return {ok:true,data:{rows:[]}}};
  s.exec=async()=>({ok:true,data:{items:[],mode:'click'}});
  await s.runFlow();assert.equal(error,undefined);return {actions,waits};
}
(async()=>{
  assert.equal((await scenario({maxPages:3,autoNext:true,nextWaitSec:0})).actions,3);
  assert.equal((await scenario({maxPages:3,autoNext:false},{limitEnabled:true,count:20})).actions,1);
  assert.equal((await scenario({maxPages:5},{limitEnabled:true,count:2})).actions,2);
  const r=await scenario({maxPages:3,nextWaitSec:.01,beforeWaitSec:.02});
  assert.deepEqual(r.waits,[20,10,20,10,20]);
  const waits=[];const s=new Scraper({}, {cfg:{}});s.wait=async ms=>waits.push(ms);
  await s.beforeNode({name:'list',params:{before:{enabled:true}}});
  await s.beforeNode({name:'list',params:{before:{enabled:true,mode:'fixed',seconds:.01}}});
  await s.beforeNode({name:'list',params:{before:{enabled:true,mode:'random'}}});
  assert.equal(waits[0],0);assert.equal(waits[1],10);assert.ok(waits[2]>=3000&&waits[2]<=15000);
  let clock=0,loading=false;
  const timed=new Scraper({webContents:{isLoading:()=>loading}},{cfg:{},clock:()=>clock});
  timed.wait=async ms=>{clock+=ms;};await timed.waitLoad(0);
  loading=true;await assert.rejects(timed.waitLoad(0),/加载超时/);
  await assert.rejects(timed.waitLoad(100),/加载超时/);assert.equal(clock,100);
  let tries=0,error;
  const retry=new Scraper({}, {cfg:{fields:[],flow:[{id:'p',type:'pages',name:'p',params:{},children:[{id:'c',type:'click',name:'c',params:{retries:2}}]}]},opts:{autoNext:false},onError:e=>error=e});
  retry.runAction=async()=>++tries<3?{ok:false,error:'temporary'}:{ok:true};retry.waitLoad=async()=>{};
  await retry.runFlow();assert.equal(error,undefined);assert.equal(tries,3);
  console.log('PASS: task/node page limits, autoNext, exact waits including 0, explicit random waits');
})().catch(e=>{console.error(e);process.exitCode=1});
