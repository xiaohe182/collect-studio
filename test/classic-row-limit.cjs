const assert=require('node:assert/strict');
const {Scraper}=require('../engine/orchestrator');
(async()=>{
 const rows=[],budgets=[];let errors=[],page=0;
 const s=new Scraper({webContents:{isLoading:()=>false,getURL:()=> 'https://example.test/list'}},{cfg:{list:{selector:'article'},fields:[{name:'id'}]},opts:{autoNext:true,maxPages:3,maxRows:3,nextWaitSec:0},onRows:batch=>rows.push(...batch),onError:error=>errors.push(error)});
 // The page adapter deliberately returns a larger batch than the remaining
 // budget: the orchestrator still has to protect the run-wide row boundary.
 s.exec=async code=>code.includes('function v6CountItems')?{ok:true,data:{count:2}}:{ok:true,data:{ok:true,mode:'click'}};
 s.collect=async(cfg,opts)=>{budgets.push(opts.maxRows);page++;return {ok:true,data:{rows:[['p'+page+'a'],['p'+page+'b']],rounds:1}};};
 await s.run();assert.deepEqual(errors,[]);assert.deepEqual(rows,[['p1a'],['p1b'],['p2a']]);assert.deepEqual(budgets,[3,1]);assert.equal(s.total,3);
 console.log('PASS classic pagination enforces the run-wide row limit and passes only the remaining budget');
})().catch(e=>{console.error(e);process.exitCode=1;});
