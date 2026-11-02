'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {ResultJournal}=require(process.env.V6_JOURNAL_SOURCE||'../engine/result-journal');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-journal-errors-'));
async function timeout(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('journal request hung')),3000);})]);}finally{clearTimeout(timer);}}
(async()=>{
  let journal;
  try{
    const blockedRoot=path.join(root,'blocked-root');fs.writeFileSync(blockedRoot,'block');
    journal=new ResultJournal(path.join(blockedRoot,'journal.jsonl'),()=>{});
    await assert.rejects(timeout(journal.flush()),/ENOTDIR|EEXIST|EPERM|EACCES/);
    await assert.rejects(timeout(journal.close()),/ENOTDIR|EEXIST|EPERM|EACCES/);journal=null;
    const file=path.join(root,'valid.jsonl');journal=new ResultJournal(file,()=>{});
    journal.write({type:'start',fields:[{name:'编号'}]});await timeout(journal.flush());
    const invalidParent=path.join(root,'not-directory');fs.writeFileSync(invalidParent,'block');
    await assert.rejects(timeout(journal.snapshot(path.join(invalidParent,'123.json'),{summary:{total:1},fields:[],rows:[['value']],logs:[]})),/ENOTDIR|EEXIST/);
    // An unrelated history snapshot failure must leave the result journal usable.
    journal.write({type:'commit',rows:[['safe']]});await timeout(journal.flush());
    assert.match(fs.readFileSync(file,'utf8'),/safe/);
    await journal.worker.terminate();
    await assert.rejects(timeout(journal.flush()),/线程|退出|关闭/);
    await assert.rejects(timeout(journal.close()),/线程|退出|关闭/);journal=null;
    console.log('PASS initialization, snapshot and unexpected worker exit reject without hanging; backup remains usable after snapshot error');
  }finally{await journal?.worker.terminate();fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
