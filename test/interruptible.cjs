const assert=require('node:assert/strict');
const {Scraper}=require('../engine/orchestrator');
(async()=>{
 const s=new Scraper({webContents:{stop(){},executeJavaScript:async()=>{}}},{cfg:{}});
 // A stop promise is pending throughout the run. Every .then attached to it
 // retains its reaction closure until stop, even after Promise.race completes.
 let retained=0;
 const original=s.stopSignal;
 if(original)s.stopSignal={then(fn){retained++;return original.then(fn);}};
 for(let i=0;i<10000;i++)assert.equal(await s.interruptible(Promise.resolve(i)),i);
 assert.equal(retained,0,'completed operations must not accumulate pending stop promise reactions');
 if(s.stopListeners)assert.equal(s.stopListeners.size,0);
 await assert.rejects(s.interruptible(new Promise(()=>{}),5),/超时/);
 if(s.stopListeners)assert.equal(s.stopListeners.size,0);
 const pending=s.interruptible(new Promise(()=>{}));s.stop();await assert.rejects(pending,/stopped/);
 if(s.stopListeners)assert.equal(s.stopListeners.size,0);
 console.log('PASS 10000 completed operations retain no stop listeners; timeout and stop clean up listeners');
})().catch(e=>{console.error(e);process.exitCode=1;});
