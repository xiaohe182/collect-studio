const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict');
const {Scraper}=require('../engine/orchestrator'),storage=require('../engine/storage');
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});try{
 const condition=storage.getTask('e148ccd7-aabc-401d-9a48-bbb2452d300f').flow.at(-1);
 for(const appears of [true,false]){
  await win.loadURL('data:text/html,<body></body>');
  await win.webContents.executeJavaScript(`window.clicked=0;${appears?`setTimeout(()=>{document.body.innerHTML='<div class="el-message-box"><button>覆盖</button></div>';document.querySelector('button').onclick=()=>window.clicked++;},200)`:''}`);
  const node=structuredClone(condition);node.params.timeout=.5;let error;const logs=[];
  await new Scraper(win,{cfg:{fields:[],flow:[node]},onError:e=>error=e,onLog:s=>logs.push(s)}).run();
  assert.equal(error,undefined);assert.equal(await win.webContents.executeJavaScript('window.clicked'),appears?1:0);
  assert.ok(logs.some(s=>s.includes(appears?'条件成立':'条件不成立')));
 }
 console.log('PASS: saved condition clicks delayed cover dialog once; absent dialog skips without error');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
