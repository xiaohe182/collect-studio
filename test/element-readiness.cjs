const assert=require('node:assert/strict'),{Scraper}=require('../engine/orchestrator');
async function run(params,readyAt,opts={loadTimeoutSec:25}){
 let clock=0,calls=0;const s=new Scraper({webContents:{getURL:()=> 'https://example.test/list'}},{cfg:{},opts,clock:()=>clock});
 s.wait=async ms=>{clock+=ms};s.exec=async()=>{calls++;return clock>=readyAt?{ok:true}:{ok:false,retryable:true,error:'节点未匹配元素'}};
 const result=await s.runAction({name:'分页器',params},{},null);return {result,clock,calls};
}
(async()=>{
 assert.equal((await run({},12000)).result.ok,true);
 assert.equal((await run({},350)).clock,400);
 const short=await run({timeout:8},12000);assert.equal(short.result.ok,false);assert.equal(short.clock,8000);assert.match(short.result.error,/该节点设置/);
 assert.equal((await run({timeout:0},1)).calls,1);
 assert.equal((await run({optional:true},12000)).clock,1000);
 assert.equal((await run({},30000,{loadTimeoutSec:40})).result.ok,true);
 console.log('PASS inherited timeout, readiness early exit, explicit timeout, zero and optional wait');
})().catch(e=>{console.error(e);process.exitCode=1});
