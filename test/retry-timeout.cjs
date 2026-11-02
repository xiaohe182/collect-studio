'use strict';
const assert=require('node:assert/strict'),{Scraper}=require('../engine/orchestrator');
(async()=>{
  const rows=[],logs=[],errors=[];let attempts=0;
  const scraper=new Scraper({webContents:{getURL:()=>''}},{cfg:{fields:[{name:'值'}],flow:[{id:'retry',type:'click',name:'允许跳过的动作',params:{retries:2,onError:'continue'}},{id:'after',type:'extract',name:'后续提取',params:{}}]},onRows:batch=>rows.push(...batch),onLog:message=>logs.push(message),onError:message=>errors.push(message)});
  scraper.runAction=async node=>node.id==='retry'?(attempts++,{ok:false,missing:true,retryable:true,error:'元素等待超时'}):{ok:true,data:{rows:[['后续数据']]}};
  await scraper.run();
  assert.deepEqual(errors,[],'显式允许重试和继续的节点不能被超时直接终止');assert.equal(attempts,3);assert.deepEqual(rows,[['后续数据']]);assert.equal(logs.filter(message=>message.includes(' 重试 ')).length,2);assert.ok(logs.some(message=>message.includes('跳过失败步骤')));
  console.log('PASS explicit timeout retries/continue preserved; later extraction executes once');
  let collections=0;const listRows=[],listErrors=[];
  const list=new Scraper({webContents:{getURL:()=>''}},{cfg:{list:{type:'css',selector:'article'},fields:[{name:'值'}],flow:[{id:'list',type:'list',name:'重试列表',params:{retries:1},children:[{id:'extract',type:'extract',name:'提取',params:{}}]}]},onRows:batch=>listRows.push(...batch),onError:error=>listErrors.push(error)});
  list.waitForList=async()=>({ok:true,data:{count:1}});list.exec=async()=>({ok:true,data:{}});
  list.collectTable=async()=>++collections===1?{ok:false,error:'所选表格不存在，请重新选择'}:{ok:true,data:{rows:[['重试成功']],rounds:0,ms:0}};
  await list.run();assert.equal(collections,2,'暂时采集执行失败仍应遵守列表显式重试');assert.deepEqual(listErrors,[]);assert.deepEqual(listRows,[['重试成功']]);
  console.log('PASS transient list collection failure honors configured retry');
})().catch(error=>{console.error(error);process.exitCode=1;});
