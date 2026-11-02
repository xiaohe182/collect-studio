const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-monitor-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),Module=require('node:module'),isolated=new Module(path.join(root,'engine','storage.js'));isolated.filename=path.join(root,'engine','storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);require('../main');
const wait=async f=>{const end=Date.now()+30000;while(Date.now()<end){if(await f())return;await new Promise(r=>setTimeout(r,100));}throw Error('test timeout');};
app.whenReady().then(async()=>{let server;try{
 const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const run=c=>win.webContents.executeJavaScript(c);
 assert.equal(await run(`$('btnTogglePreview').getAttribute('aria-expanded')`),'false');
 assert.equal(await run(`$('preview').offsetHeight`),52);
 assert.equal(await run(`document.getElementById('saveStatus')`),null);
 server=http.createServer((q,s)=>{s.setHeader('Content-Type','text/html;charset=utf-8');s.end(`<body style="margin:0"><article>first</article><div style="height:12000px"></div><button id="next" onclick="document.querySelector('article').textContent='second';this.disabled=true">下一页</button></body>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 await run(`$('urlInput').value=${JSON.stringify(url)};go()`);
 await run(`cfg.list={type:'css',selector:'article'};cfg.fields=[{name:'商品',type:'text',rel:':scope',__on:true}];const pages=Workflow.node('pages');pages.params={selector:'body > button#next',count:2};const list=Workflow.node('list');list.children=[Workflow.node('extract')];const next=Workflow.node('next');next.params={selector:'#next',mode:'css'};pages.children=[list,next];cfg.flow=[pages];renderFields();selectNode(pages.id);$('optScrollWait').value=100;$('optScrollSec').value=20;$('optNextWait').value=0;startScrape()`);
 await wait(()=>run(`$('resultsDialog').open&&scraping`));
 assert.equal(await run(`$('btnResultStop').hidden`),false);
 assert.equal(await run(`resultTab`),'data');
 await run(`$('btnResultLogTab').click()`);
 await wait(()=>run(`$('runResultsBody').textContent.includes('滚动第')`));
 assert.match(await run(`$('resultsDialog').querySelector('h3').textContent`),/正在采集/);
 fs.writeFileSync(path.join(__dirname,'shots','run-monitor-live.png'),(await win.webContents.capturePage()).toPNG());
 await wait(()=>run('!scraping'));
 const result=await run(`cmd('run-results',{})`);assert.equal(result.summary.error,undefined);assert.deepEqual(result.rows,[['first'],['second']]);
 assert.ok(result.logs.some(x=>x.message.includes('尚未到底')));assert.ok(result.logs.some(x=>x.message.includes('所有滚动区域到底')));assert.ok(result.logs.some(x=>x.message.includes('定位：css')));
 await run(`$('btnResultData').click();new Promise(r=>setTimeout(r,300))`);
 for(const [width,height] of [[1560,920],[1100,640]]){
  win.setSize(width,height);await run(`new Promise(r=>setTimeout(r,150))`);
  await run(`(()=>{const tr=$('runResultsBody').querySelector('thead tr');for(let i=0;i<10;i++){const th=document.createElement('th');th.textContent='商品字段 '+i;tr.append(th);}return new Promise(r=>requestAnimationFrame(r));})()`);
  const box=await run(`(()=>{const d=$('resultsDialog').getBoundingClientRect(),b=$('runResultsBody');b.scrollLeft=100;return {fit:d.top>=0&&d.bottom<=innerHeight,scroll:b.scrollWidth>b.clientWidth&&b.scrollLeft>0}})()`);
  assert.ok(box.fit&&box.scroll,'dialog fits, wide columns scroll inside body');
  fs.writeFileSync(path.join(__dirname,'shots','run-dashboard-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
 }
 const page=win.contentView.children.find(v=>v.webContents).webContents;
 await page.executeJavaScript(`document.body.style.height='1000000px';window.scrollTo(0,0)`);
 await run(`$('resultsDialog').close();$('optScrollSec').value=5;startScrape()`);await wait(()=>run('!scraping'));
 const limited=await run(`cmd('run-results',{})`);assert.match(limited.summary.error,/尚未确认滚动完成/);assert.equal(limited.rows.length,1);assert.ok(!limited.logs.some(x=>x.message.startsWith('点击翻页，')));
 console.log('PASS: old CSS pagination without mode, two pages, long page reaches bottom, live execution dialog/logs, timeout keeps data and prevents next-page click');app.exit(0);
}catch(e){console.error(e);app.exit(1);}finally{server?.close();}});
