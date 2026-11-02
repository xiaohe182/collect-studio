const {app,BrowserWindow,dialog}=require('electron'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-delete-'));app.setPath('userData',path.join(root,'profile'));const storage=require('../engine/storage'),Module=require('module'),m=new Module(path.join(root,'engine/storage.js'));m.filename=path.join(root,'engine/storage.js');m._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),m.filename);Object.assign(storage,m.exports);for(const id of ['active','old1','old2'])storage.saveTask({id,name:id,url:'https://example.com',flow:[],fields:[]});let answer=0;dialog.showMessageBox=async()=>({response:answer});require('../main');
app.whenReady().then(async()=>{try{
const folder=path.join(storage.tasksDir(),'runs');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'123.json'),JSON.stringify({summary:{name:'分页测试'},fields:[{name:'产品编号'},{name:'产品名称'}],rows:Array.from({length:235},(_,i)=>['P'+(i+1),'产品 '+(i+1)]),logs:[]}));
const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const run=s=>win.webContents.executeJavaScript(s);
await run("resultRunId='123';resultPage=0;resultTab='data';drawRunResults()");
assert.ok(await run("$('runResultsBody').querySelectorAll('tbody tr').length")<30);
assert.equal(await run("$('resultPage').textContent"),'1 / 3');
assert.equal(await run("$('btnResultPrev').disabled"),true);
await run("$('btnResultNext').onclick()");assert.equal(await run("$('runResultsBody').querySelector('tbody td').textContent"),'101');
await run("$('resultJump').value='3';$('resultJump').onchange()");assert.ok(await run("$('runResultsBody').querySelectorAll('tbody tr').length")<30);assert.equal(await run("$('runResultsBody').querySelector('tbody td').textContent"),'201');assert.equal(await run("$('btnResultNext').disabled"),true);
await run("$('resultJump').value='999';$('resultJump').onchange()");assert.equal(await run("$('resultJump').value"),'3');
await run("$('resultJump').value='0';$('resultJump').onchange()");assert.equal(await run('resultPage'),0);
await run("$('resultJump').value='abc';$('resultJump').onchange()");assert.equal(await run("$('resultJump').value"),'1');
const data=await run("cmd('run-results',{id:'123',page:1})");assert.equal(data.pageSize,100);assert.equal(data.rows.length,100);assert.equal(data.rows[0][0],'P101');
await run("openPanelDialog('resultsDialog')");await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(__dirname,'shots','result-pagination.png'),(await win.webContents.capturePage()).toPNG());
await run("resultRunId=null;resultPage=0;drawRunResults()");assert.equal(await run("$('resultPage').textContent"),'1 / 1');assert.equal(await run("$('resultJump').disabled&&$('btnResultPrev').disabled&&$('btnResultNext').disabled"),true);
console.log('PASS 100 rows/page, row numbering, jump/clamping/invalid input, empty results, history IPC');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
