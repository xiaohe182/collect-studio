const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ResultJournal}=require('../engine/result-journal'),{readJournal}=require('../engine/journal-reader');
(async()=>{
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'v6-journal-')),'采集.jsonl');let error;
 const journal=new ResultJournal(file,e=>error=e);journal.write({type:'start',fields:[{name:'编号'}]});
 let beats=0;const tick=setInterval(()=>beats++,5),started=Date.now();
 for(let batch=0;batch<300;batch++){
   journal.write({type:'commit',rows:Array.from({length:1000},(_,i)=>[String(batch*1000+i),'中文产品'])});
   if(batch%10===0)await new Promise(r=>setImmediate(r));
 }
 journal.write({type:'preview',collection:'current',rows:[{id:'a',values:['partial']}]});
 journal.write({type:'preview',collection:'current',rows:[{id:'a',values:['completed cell']}]});
 await journal.close();clearInterval(tick);assert.equal(error,undefined);assert.ok(beats>5);
 fs.appendFileSync(file,'{"type":"preview","rows":');
 const result=await readJournal(file);assert.equal(result.rows.length,300001);assert.equal(result.rows[299999][0],'299999');assert.equal(result.rows.at(-1)[0],'completed cell');
 console.log(JSON.stringify({pass:true,rows:result.rows.length,ms:Date.now()-started,uiHeartbeats:beats,bytes:fs.statSync(file).size}));
})().catch(e=>{console.error(e);process.exitCode=1;});
