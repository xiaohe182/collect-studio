'use strict';
// One page can contain hundreds of thousands of rows; write must apply backpressure.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{performance}=require('node:perf_hooks');
const {ResultJournal}=require(process.env.V6_JOURNAL_SOURCE||'../engine/result-journal');
const {readJournal}=require('../engine/journal-reader');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-journal-write-'));
(async()=>{
  let journal;const keeper=setInterval(()=>{},1000);
  try{
    const file=path.join(root,'journal.jsonl');let error;
    journal=new ResultJournal(file,message=>{error=message;});
    journal.write({type:'start',fields:[{name:'编号'}]});await journal.flush();
    const rows=Array.from({length:200000},(_,i)=>[String(i),...Array.from({length:15},(_,j)=>'商品'+j+' '+('内容'.repeat(8)))]);
    let last=performance.now(),maxGap=0,beats=0;
    const tick=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;beats++;},5);
    await new Promise(resolve=>setTimeout(resolve,15));const start=performance.now();
    journal.write({type:'preview',collection:'old',rows:[{id:'old',values:['must-clear']}]});
    journal.write({type:'clear'});
    journal.write({type:'commit',rows});
    journal.write({type:'preview',collection:'new',rows:[{id:'p',values:['partial']}]});
    journal.write({type:'preview',collection:'new',rows:[{id:'p',values:['updated']}]});
    journal.write({type:'end',summary:{total:200000}});
    await journal.snapshot(path.join(root,'barrier.json'),{summary:{total:0},fields:[],rows:[],logs:[]});
    const tail=Buffer.alloc(100),fd=fs.openSync(file,'r');
    const length=fs.statSync(file).size;fs.readSync(fd,tail,0,100,Math.max(0,length-100));fs.closeSync(fd);
    assert.match(tail.toString(),/"type":"end"/,'snapshot must wait for the earlier journal writes');
    await journal.flush();
    await new Promise(resolve=>setTimeout(resolve,15));clearInterval(tick);
    const ms=Math.round(performance.now()-start);
    assert.equal(error,undefined);assert.ok(maxGap<100,'journal.write blocked the main loop for '+Math.round(maxGap)+'ms');
    await journal.close();journal=null;
    const saved=await readJournal(file);assert.equal(saved.rows.length,200001);assert.equal(saved.rows[0][0],'0');assert.equal(saved.rows[199999][0],'199999');assert.deepEqual(saved.rows[200000],['updated']);
    assert.ok(!saved.rows.some(row=>row[0]==='must-clear'));
    console.log(JSON.stringify({pass:true,rows:200000,columns:16,ms,maxGap:Math.round(maxGap),beats,bytes:fs.statSync(file).size}));
  }finally{clearInterval(keeper);await journal?.worker.terminate();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
