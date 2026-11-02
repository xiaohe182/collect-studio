const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-renderer-perf-')));
const taskFixtures=Array.from({length:5000},(_,i)=>({id:String(i),name:'任务'+i,group:'',url:'about:blank'}));
ipcMain.handle('panel-cmd',async(_event,command)=>{
  if(command==='run-results')return {ok:true,summary:{},fields:[],rows:[],logs:[],page:0,pageSize:100,total:0};
  if(command==='task-list')return {ok:true,tasks:taskFixtures,groups:[]};
  if(command==='run-history'){await new Promise(resolve=>setTimeout(resolve,60));return {ok:true,history:[{id:'history-fixture',name:'延迟历史',at:1,total:1}]};}
  return {ok:true};
});
app.whenReady().then(async()=>{try{
  const w=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{preload:path.join(__dirname,'../preload.js'),backgroundThrottling:false}});
  await w.loadFile(path.join(__dirname,'../renderer/index.html'));
  const run=code=>w.webContents.executeJavaScript(code);
  const preview=await run(`(()=>{cfg.fields=Array.from({length:150},(_,i)=>({name:'列'+i}));const sample=Array.from({length:100},(_,r)=>Array.from({length:150},(_,c)=>r+':'+c));renderTable(sample,100000);const first=dataTable.querySelector('td');let time=performance.now();for(let i=0;i<20;i++)renderTable(sample,100000+i);return {ms:performance.now()-time,cells:dataTable.querySelectorAll('td').length,reused:first===dataTable.querySelector('td'),total:rowCount.textContent};})()`);
  const tasks=await run(`(()=>{taskEntries=Array.from({length:5000},(_,i)=>({id:String(i),name:'任务'+i,group:'',url:'about:blank'}));for(const task of taskEntries)selectedTaskIds.add(task.id);let time=performance.now();renderTasks();return {ms:performance.now()-time,nodes:taskList.childElementCount};})()`);
  const logging=await run(`(()=>{const time=performance.now();for(let i=0;i<1000;i++)log('模拟滚动进度 '+i);return {ms:performance.now()-time,nodes:$('log').childElementCount};})()`);
  console.log(JSON.stringify({preview20x15000Cells:preview,tasks5000:tasks,logs1000:logging}));
  assert.equal(preview.reused,true,'unchanged first 100 rows must reuse the editable preview DOM');
  assert.equal(preview.total,'共100019条数据');
  const changed=await run(`(()=>{const sample=Array.from({length:100},(_,r)=>Array.from({length:150},(_,c)=>r+':'+c));sample[0][0]='changed';renderTable(sample,100020);return dataTable.querySelector('td').textContent;})()`);
  assert.equal(changed,'changed','changed live cells must still update');
  const selection=await run(`(async()=>{const original=Array.prototype.some;let scanned=0;Array.prototype.some=function(...args){if(this===taskEntries)scanned+=this.length;return original.apply(this,args)};try{$('tasksDialog').showModal();const time=performance.now();await refreshTasks();return {ms:performance.now()-time,scanned,selected:selectedTaskIds.size};}finally{Array.prototype.some=original;}})()`);
  console.log(JSON.stringify({selectedTasksRefresh:selection}));
  assert.equal(selection.selected,5000,'refresh must retain valid task selections');
  assert.ok(selection.scanned<=10000,'refreshing selected tasks must avoid one complete task scan per selection');
  const historyRace=await run(`(async()=>{resultTab='history';const pending=drawRunResults();await new Promise(resolve=>setTimeout(resolve,10));resultTab='data';await drawRunResults();await pending;return $('runResultsBody').textContent.includes('延迟历史');})()`);
  assert.equal(historyRace,false,'a late history reply must not overwrite the selected data tab');
  const burst=await run(`(async()=>{let added=0;const observer=new MutationObserver(records=>{for(const record of records)added+=record.addedNodes.length;});observer.observe(dataTable.querySelector('tbody'),{childList:true});for(let i=0;i<20;i++)schedulePreview([['value-'+i]],200+i);await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));observer.disconnect();return {added,value:dataTable.querySelector('td').textContent,total:rowCount.textContent};})()`);
  assert.equal(burst.added,1,'a burst of live updates must build only the newest preview');
  assert.equal(burst.value,'value-19');assert.equal(burst.total,'共219条数据');
  console.log('PASS preview cache, changed-cell refresh, burst coalescing, linear task selection refresh and stale history reply protection');
  app.exit(0);
}catch(error){console.error(error);app.exit(1);}});
