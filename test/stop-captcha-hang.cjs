'use strict';
const assert=require('node:assert/strict'),{Scraper}=require('../engine/orchestrator');
(async()=>{
  let enteredStatus,hidden=false,done,emitted=false;
  const ready=new Promise(resolve=>{enteredStatus=resolve;});
  const scraper=new Scraper({webContents:{stop(){},executeJavaScript(code){
    if(code.includes(')("show",'))return Promise.resolve({ok:true});
    if(code.includes(')("status",')){enteredStatus();return new Promise(()=>{});}
    if(code.includes(")('hide')")){hidden=true;return new Promise(()=>{});}
    return Promise.resolve(true);
  }}},{cfg:{fields:[],flow:[{id:'captcha',type:'captcha',name:'验证码',params:{timeout:120}},{id:'after',type:'extract',name:'后续提取',params:{}}]},onDone:value=>done=value,onRows:()=>{emitted=true;}});
  const running=scraper.run();await ready;const started=performance.now();scraper.stop();
  let timer;try{await Promise.race([running,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('验证码网页与清理脚本挂起时停止仍未完成')),400);})]);}finally{clearTimeout(timer);}
  assert.equal(hidden,true);assert.equal(done.stopped,true);assert.equal(emitted,false);assert.equal(scraper.stopListeners.size,0);
  console.log('PASS hanging captcha status/cleanup cannot block stop: '+(performance.now()-started).toFixed(1)+'ms');
})().catch(error=>{console.error(error);process.exitCode=1;});
