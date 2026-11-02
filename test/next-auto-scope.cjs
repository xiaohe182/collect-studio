const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),W=require('../engine/workflow'),{Scraper}=require('../engine/orchestrator');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-next-auto-')));
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});try{
 const html='<article>第一页</article><button id="legacy" onclick="document.querySelector(\'article\').textContent=\'legacy\'">旧定位</button><button id="next" onclick="document.querySelector(\'article\').textContent=\'auto\'">下一页</button>';
 async function run(params){await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));const next=W.node('next');next.params=params;let error;await new Scraper(win,{cfg:{list:{type:'css',selector:'article'},fields:[],nextSel:{type:'css',selector:'#legacy'},flow:[next]},opts:{nextWaitSec:0,loadTimeoutSec:.1},onError:e=>error=e}).run();assert.equal(error,undefined);return win.webContents.executeJavaScript("document.querySelector('article').textContent");}
 assert.equal(await run({mode:'css',selector:''}),'auto','cleared node must use automatic next, not the legacy task selector');
 assert.equal(await run({}),'legacy','unconfigured legacy node still inherits the task selector');
 assert.equal(await run({selector:null}),'legacy','legacy null selector retains its fallback behavior');
 console.log('PASS explicit automatic next and legacy fallback choose different actual buttons');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
