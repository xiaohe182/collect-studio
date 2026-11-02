const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict');
const {lockRunViewport}=require('../engine/run-viewport');
app.setPath('userData',require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'viewport-')));
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:1300,height:900});try{
await w.loadURL('data:text/html,'+encodeURIComponent('<style>@media(max-width:1000px){input{display:none}}</style><input placeholder="page">'));
await lockRunViewport(w.webContents,{width:1200,height:800});
const read=()=>w.webContents.executeJavaScript('({width:innerWidth,shown:!!document.querySelector("input").getClientRects().length})');
assert.deepEqual(await read(),{width:1200,shown:true});w.setSize(600,500);await new Promise(r=>setTimeout(r,100));assert.deepEqual(await read(),{width:1200,shown:true});
await new (require('../engine/orchestrator').Scraper)(w,{cfg:{}}).setTableZoom(.5);await new Promise(r=>setTimeout(r,150));assert.deepEqual(await read(),{width:1200,shown:true});
assert.equal(w.webContents.getZoomFactor(),1);
await lockRunViewport(w.webContents,{width:1200,height:800},{width:600,height:400});assert.deepEqual(await read(),{width:1200,shown:true});
const collector=new (require('../engine/orchestrator').Scraper)(w,{cfg:{}});collector.exec=()=>{throw Error('Locked layout must not trigger page zoom');};
await collector.collectTable({list:{}},{fitTable:true},async()=>true);assert.equal(w.webContents.getZoomFactor(),1);
console.log('PASS layout viewport preserved across resize and table zoom');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
