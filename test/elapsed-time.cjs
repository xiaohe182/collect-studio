const assert=require('node:assert/strict');
const {Scraper}=require('../engine/orchestrator');
let time=1000;
const create=()=>new Scraper({webContents:{}},{cfg:{},clock:()=>time});
const first=create();time+=10000;assert.equal(first.elapsedMs(),10000);
for(let i=0;i<100;i++)assert.equal(first.elapsedMs(),10000,'refresh must not accumulate elapsed time');
time+=2000;assert.equal(first.elapsedMs(),12000);
const next=create();time+=3000;assert.equal(next.elapsedMs(),3000,'a new run starts with a fresh elapsed clock');
console.log('PASS elapsed time, repeated refreshes and new run clock');
