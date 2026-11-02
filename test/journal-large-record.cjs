'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readJournal}=require('../engine/journal-reader');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-journal-record-'));
(async()=>{
  try{
    const file=path.join(root,'large.jsonl'),rows=Array.from({length:180000},(_,i)=>[String(i)]);
    fs.writeFileSync(file,JSON.stringify({type:'start',fields:[{name:'编号'}]})+'\n'+JSON.stringify({type:'commit',rows})+'\n'+JSON.stringify({type:'preview',collection:'last',rows:[{id:'p',values:['partial']}]})+'\n');
    const recovered=await readJournal(file);assert.equal(recovered.rows.length,180001);assert.equal(recovered.rows[179999][0],'179999');assert.deepEqual(recovered.rows[180000],['partial']);
    console.log('PASS journal recovers a 180000-row commit without argument-limit overflow');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
