'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{performance}=require('node:perf_hooks');
const {ResultJournal}=require('../engine/result-journal');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-journal-snapshot-'));
(async()=>{
  let journal;const keeper=setInterval(()=>{},1000);
  try{
    const file=path.join(root,'journal.jsonl'),snapshot=path.join(root,'runs','123.json');
    journal=new ResultJournal(file,error=>{throw new Error(error);});
    const fields=Array.from({length:8},(_,i)=>({name:'字段'+i}));
    const rows=Array.from({length:120000},(_,i)=>[String(i),...Array.from({length:7},(_,j)=>'商品'+j+' '+('内容'.repeat(16)))]);
    const data={summary:{name:'snapshot',total:120000},fields,rows,logs:[{time:'now',message:'synthetic'}]};
    journal.write({type:'start',fields});await journal.flush();
    let last=performance.now(),maxGap=0,beats=0;
    const tick=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;beats++;},5);
    await new Promise(resolve=>setTimeout(resolve,15));const start=performance.now();
    await journal.snapshot(snapshot,data);
    await new Promise(resolve=>setTimeout(resolve,15));clearInterval(tick);
    const ms=Math.round(performance.now()-start);
    assert.ok(maxGap<80,'snapshot transfer blocked the main loop for '+Math.round(maxGap)+'ms');
    const saved=JSON.parse(fs.readFileSync(snapshot,'utf8'));assert.equal(saved.rows.length,120000);assert.equal(saved.rows[119999][0],'119999');assert.deepEqual(saved.summary,data.summary);assert.deepEqual(saved.logs,data.logs);assert.equal(saved.fields.length,8);
    assert.deepEqual(JSON.parse(fs.readFileSync(snapshot+'.summary','utf8')),data.summary);assert.equal(fs.existsSync(snapshot+'.tmp'),false);
    journal.write({type:'commit',rows:[['after snapshot']]});await journal.close();journal=null;
    assert.match(fs.readFileSync(file,'utf8'),/after snapshot/);
    console.log(JSON.stringify({pass:true,rows:120000,columns:8,ms,maxGap:Math.round(maxGap),beats,bytes:fs.statSync(snapshot).size}));
  }finally{clearInterval(keeper);await journal?.worker.terminate();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
