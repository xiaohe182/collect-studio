const assert=require('node:assert/strict'),{Scraper}=require('../engine/orchestrator');
async function scenario(scrollLoad){
 const field={name:'value'},list={type:'xpath',selector:'//tr',genericGrid:true};
 const cfg={fields:[field],list,flow:[{id:'scroll',type:'scrollLoop',name:'outer scroll',params:{count:100},children:[{id:'pages',type:'pages',name:'pages',params:{limitEnabled:false},children:[{id:'list',type:'list',name:'list',params:{list},children:[{id:'extract',type:'extract',name:'extract',params:{fields:[field],dedupe:false}}]},{id:'next',type:'next',name:'next',params:{}}]}]}]};
 const events=[];let error;
 const s=new Scraper({webContents:{isLoading:()=>false,getURL:()=>''}},{cfg,opts:{maxPages:3,scrollLoad,autoNext:true,nextWaitSec:0},onError:e=>error=e});
 s.wait=async()=>{};s.waitForList=async()=>({ok:true,data:{count:20}});
 s.exec=async(code,_cfg,options)=>{
   if(code.includes('return v6ScrollCollect.apply')){events.push(['collect',options.scrollLoad]);return {ok:true,data:{rows:[['row']],rounds:4,ms:100,reason:'完成表格扫描'}};}
   if(code.includes('return v6ClickNext.apply')){events.push(['next']);return {ok:true,data:{mode:'click'}};}
   return {ok:true,data:{items:[]}};
 };
 await s.runFlow();assert.equal(error,undefined);
 assert.deepEqual(events,[['collect',scrollLoad],['next'],['collect',scrollLoad],['next'],['collect',scrollLoad]]);
 assert.equal(s.pages,3);assert.equal(s.total,3);
}
(async()=>{await scenario(true);await scenario(false);console.log('PASS: nested scrolling preserves page collection option, collects before next, executes pages once');})().catch(e=>{console.error(e);process.exitCode=1;});
