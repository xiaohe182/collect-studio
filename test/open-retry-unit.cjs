'use strict';
const assert=require('node:assert/strict'),{Scraper}=require('../engine/orchestrator');
(async()=>{
 let actions=0,rows=0,error;const waits=[];
 const input=new Scraper({webContents:{getUserAgent:()=>'',session:{getUserAgent:()=>''}}},{cfg:{fields:[],flow:[{id:'input',type:'input',name:'input',params:{selector:'input',after:{enabled:true,seconds:.123}}}]},onError:e=>error=e});
 input.runAction=async()=>({ok:true});input.wait=async ms=>waits.push(ms);await input.run();assert.equal(error,undefined);assert.deepEqual(waits,[123],'input after wait executes exactly once');
 const s=new Scraper({webContents:{getURL:()=>''}},{cfg:{fields:[{name:'value'}],flow:[{id:'loop',type:'repeat',name:'loop',params:{count:2,retries:2},children:[{id:'extract',type:'extract',name:'extract',params:{dedupe:false}},{id:'fail',type:'click',name:'fail',params:{}}]}]},onRows:r=>rows+=r.length,onError:e=>error=e});
 s.runAction=async n=>n.type==='extract'?{ok:true,data:{rows:[['value']]}}:(actions++,{ok:false,error:'failed'});await s.run();assert.match(error,/failed/);assert.equal(actions,1);assert.equal(rows,1,'committed collecting loop must never replay');
 console.log('PASS input after wait executes once; legacy retry cannot replay collecting loop after rows commit');
})().catch(e=>{console.error(e);process.exitCode=1;});
