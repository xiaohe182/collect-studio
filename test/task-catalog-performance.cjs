'use strict';
// Catalog responses must contain only task metadata, and cold disk scans stay off main.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{performance}=require('node:perf_hooks');
const io=require('../engine/result-io');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-task-catalog-'));
(async()=>{
  try{
    assert.equal(typeof io.readTaskCatalog,'function','cold task catalogs need a worker API');
    const folder=path.join(root,'tasks');fs.mkdirSync(path.join(folder,'archive'),{recursive:true});
    const flow=Array.from({length:80},(_,i)=>({id:'node'+i,type:'input',params:{value:'PRIVATE_SYNTHETIC_VALUE '+('data'.repeat(20))}}));
    for(let i=0;i<2000;i++)fs.writeFileSync(path.join(folder,i<1000?'':'archive',String(i)+'.json'),JSON.stringify({id:'ignored-id',name:'Task '+i,url:'https://example.invalid/'+i,group:'Group '+i%10,updatedAt:new Date(1700000000000+i*1000).toISOString(),password:'PRIVATE_SYNTHETIC_PASSWORD',flow}));
    fs.writeFileSync(path.join(folder,'groups.json'),JSON.stringify(['Declared empty','Group 4']));
    fs.writeFileSync(path.join(folder,'broken.json'),'{"url":');
    let last=performance.now(),maxGap=0,beats=0;
    const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-last);last=now;beats++;},5);
    await new Promise(resolve=>setTimeout(resolve,15));const started=performance.now();
    const catalog=await io.readTaskCatalog(folder);
    await new Promise(resolve=>setTimeout(resolve,15));clearInterval(timer);
    const ms=Math.round(performance.now()-started);
    assert.ok(maxGap<100,'cold task catalog blocked the main loop for '+Math.round(maxGap)+'ms');
    assert.equal(catalog.tasks.length,1000);assert.equal(catalog.archivedTasks.length,1000);
    assert.equal(catalog.tasks[0].id,'999');assert.equal(catalog.archivedTasks[0].id,'1999');
    assert.deepEqual(catalog.groups,['Declared empty','Group 4','Group 9','Group 8','Group 7','Group 6','Group 5','Group 3','Group 2','Group 1','Group 0']);
    const response=JSON.stringify(catalog);assert.ok(!response.includes('PRIVATE_SYNTHETIC'));assert.ok(!response.includes('"flow"'));assert.ok(!response.includes('"password"'));
    assert.deepEqual(Object.keys(catalog.tasks[0]),['id','name','group','url','updatedAt']);
    const file=path.join(folder,'999.json');
    fs.writeFileSync(file,JSON.stringify({url:'https://www.changed.invalid/path',group:'New group',updatedAt:'2099',flow}));
    fs.unlinkSync(path.join(folder,'archive','1999.json'));
    fs.writeFileSync(path.join(folder,'groups.json'),JSON.stringify(['Changed declaration']));
    const changed=await io.readTaskCatalog(folder);
    assert.equal(changed.tasks[0].name,'changed.invalid');assert.equal(changed.tasks[0].group,'New group');assert.equal(changed.archivedTasks.length,999);assert.equal(changed.groups[0],'Changed declaration');assert.ok(changed.groups.includes('New group'));assert.ok(!changed.groups.includes('Declared empty'));
    assert.deepEqual(await io.readTaskCatalog(path.join(root,'missing')),{tasks:[],archivedTasks:[],groups:[]});
    console.log(JSON.stringify({pass:true,syntheticTasks:2000,flowNodesPerTask:80,ms,maxGap:Math.round(maxGap),beats,responseBytes:Buffer.byteLength(response)}));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
