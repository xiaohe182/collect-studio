const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Scraper}=require('../engine/orchestrator'),W=require('../engine/workflow');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-listwait-')));
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});try{
 for(const complex of [false,true]){
  await win.loadURL('data:text/html;charset=utf-8,<body><div id="items"></div><button id="next" onclick="items.innerHTML=\'\';setTimeout(()=>items.innerHTML=\'<article>第三条</article><article>第四条</article>\',1100)">下一页</button>');
  await win.webContents.executeJavaScript(`setTimeout(()=>items.innerHTML='<article>第一条</article><article>第二条</article>',1100)`);
  const pages=W.node('pages');pages.params.count=2;const list=W.node('list');list.params.timeout=4;list.children=[W.node('extract')];if(complex){const wait=W.node('wait');wait.params.seconds=0;list.children.unshift(wait);}const next=W.node('next');next.params.selector='#next';pages.children=[list,next];
  let rows=[],error;const logs=[];const scraper=new Scraper(win,{cfg:{flow:[pages],list:{type:'css',selector:'article'},fields:[{name:'text',type:'text',rel:':scope'}]},opts:{scrollLoad:false,nextWaitSec:0},onRows:r=>rows.push(...r),onError:e=>error=e,onLog:s=>logs.push(s)});
  await scraper.run();assert.equal(error,undefined);assert.deepEqual(rows,[['第一条'],['第二条'],['第三条'],['第四条']]);assert.ok(logs.some(s=>s.includes('等待列表加载')));
 }
 await win.loadURL('data:text/html;charset=utf-8,<body>empty');
 const scraper=new Scraper(win,{cfg:{}});const start=Date.now();await assert.rejects(scraper.waitForList({list:{type:'css',selector:'article'}},500),/等待列表加载超时/);assert.ok(Date.now()-start<1500);
 const invalid=Date.now();await assert.rejects(scraper.waitForList({list:{type:'css',selector:'['}},5000),/列表定位无效/);assert.ok(Date.now()-invalid<1000);
 const stopped=new Scraper(win,{cfg:{}});const waiting=stopped.waitForList({list:{type:'css',selector:'article'}},5000);setTimeout(()=>stopped.stop(),100);const stopStart=Date.now();assert.equal(await waiting,null);assert.ok(Date.now()-stopStart<1000);
 console.log('PASS: delayed initial and AJAX next-page lists, extract-only and multi-step loops, 4 exact rows, timeout, invalid selector, prompt stop');win.destroy();app.exit(0);
}catch(e){console.error(e);win.destroy();app.exit(1);}});
