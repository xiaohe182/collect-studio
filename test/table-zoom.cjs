const assert=require('node:assert/strict');const {Scraper}=require('../engine/orchestrator');
(async()=>{let zoom=1,history=[];const wc={getZoomFactor:()=>zoom,setZoomFactor:v=>{zoom=v;history.push(v)}};const s=new Scraper({webContents:wc},{cfg:{fields:[]},opts:{}});s.wait=async()=>{};s.exec=async(code)=>({ok:true,data:{width:1600,available:800,count:2}});let seen;
await s.collectTable({list:{}},{fitTable:true},async()=>{seen=zoom;return {ok:true}});assert.equal(seen,.5);assert.equal(zoom,1);
await assert.rejects(s.collectTable({list:{}},{fitTable:true},async()=>{throw Error('failure')}));assert.equal(zoom,1);
const scope={};await s.collectTable({list:{}},{fitTable:true},async()=>({ok:true}),scope);assert.equal(zoom,.5);const before=history.length;await s.collectTable({list:{}},{fitTable:true},async()=>({ok:true}),scope);assert.equal(history.length,before);s.restoreTableZoom(scope);assert.equal(zoom,1);assert.ok(history.length>=4);console.log('PASS table zoom only during collection and restored on success/error');})().catch(e=>{console.error(e);process.exitCode=1});


