const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-search-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),Module=require('node:module'),isolated=new Module(path.join(root,'engine','storage.js'));isolated.filename=path.join(root,'engine','storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);require('../main');
app.whenReady().then(async()=>{let server;try{
 const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const run=c=>win.webContents.executeJavaScript(c);const wait=async fn=>{const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,80));}throw Error('timeout');};
 server=http.createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');const u=new URL(req.url,'http://localhost');res.end(u.pathname==='/search'?`<section id="items">${[1,2,3].map(i=>`<article><h3>${u.searchParams.get('q')} 商品 ${i+(u.searchParams.has('page')?3:0)}</h3><b>￥${i}</b></article>`).join('')}</section>${u.searchParams.has('page')?'':`<a id="next" href="/search?q=${encodeURIComponent(u.searchParams.get('q'))}&page=2">下一页</a>`}`:'<script>window.keys=[];for(const type of ["keydown","keypress","keyup","submit"])document.addEventListener(type,e=>keys.push({type:e.type,key:e.key,trusted:e.isTrusted,target:e.target.tagName}),true);</script><form action="/search"><input id="q" name="q"><input id="city" name="city"><button>搜索</button></form>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 await run(`$('urlInput').value=${JSON.stringify(url)};go()`);const page=win.contentView.children.find(v=>v.webContents).webContents;await wait(()=>run('picking'));assert.equal(await run('ensureFlow()[0].type'),'open');
 await page.executeJavaScript(`document.querySelector('#q').click();document.querySelector('[data-action=action-input]').click();document.querySelector('[data-input-value]').value='电摩';document.querySelector('#city').click();document.querySelectorAll('[data-input-value]')[1].value='广州';document.querySelector('[data-input-enter]').checked=true;document.querySelector('[data-input-confirm]').click()`);
 await wait(()=>page.executeJavaScript(`!!document.querySelector('#items')&&!!window.__v6pick`));assert.equal(await run('cfg.flow[1].type'),'inputGroup');
 await page.executeJavaScript(`document.querySelector('article').click();document.querySelector('[data-action=list]').click();document.querySelector('[data-action=extract-auto]').click()`);
 await wait(()=>run('cfg.fields.length>0'));
 await page.executeJavaScript(`document.querySelector('#next').click();document.querySelector('[data-action=action-next]').click()`);
  await wait(()=>run(`cfg.flow.some(n=>n.type==='pages')`));
  await wait(()=>Promise.resolve(page.getURL().includes('page=2')));
  assert.equal(await page.executeJavaScript(`!!window.__v6pick`),true,'automatic next-page action restores selection');
 await run(`cfg.flow.find(n=>n.type==='pages').params.count=2;$('taskName').value='搜索录制回归';$('optScroll').checked=false`);
 await run(`$('btnApplySettings').onclick()`);
 assert.equal(await run('saveCurrentTask(true)'),true);
 const saved=await run(`cmd('task-open',{id:cfg.id})`);assert.equal(saved.cfg.flow[1].params.entries[0].value,'电摩');
 await wait(()=>Promise.resolve(page.getURL()===url+'/'&&!page.isLoading()));
 const editorURL=page.getURL();await page.executeJavaScript('window.editorMarker="preserved";localStorage.setItem("editorOnly","yes")');
 await page.session.cookies.set({url,name:'editorOnly',value:'yes'});
 await run('startScrape()');await wait(()=>run(`(async()=>{const r=await cmd('run-results',{});return !scraping&&!r.summary?.running&&r.total===6})()`));
 const execution=win.contentView.children.filter(v=>v.webContents).at(-1);
 let visible=false;const setVisible=execution.setVisible.bind(execution);execution.setVisible=value=>{visible=value;setVisible(value);};assert.notEqual(execution.webContents.id,page.id);assert.notEqual(execution.webContents.session,page.session);
 assert.equal((await execution.webContents.session.cookies.get({url,name:'editorOnly'})).length,0);
 assert.equal(await execution.webContents.executeJavaScript('localStorage.getItem("editorOnly")'),null);
 assert.equal(page.getURL(),editorURL);assert.equal(await page.executeJavaScript('window.editorMarker'),'preserved');
 await run(`$('btnShowRunPage').click()`);await wait(()=>Promise.resolve(visible));
 assert.ok(execution.getBounds().height>=160);
 await run(`showMessage('测试错误')`);await wait(()=>run(`$('messageDialog').open`));assert.equal(visible,false);
 await run(`$('btnMessageConfirm').click()`);await wait(()=>Promise.resolve(visible));
 await run(`$('resultsDialog').close()`);await wait(()=>Promise.resolve(!visible));
 const results=await run(`cmd('run-results',{})`);assert.equal(results.total,6);assert.ok(results.rows.some(row=>row.some(v=>String(v).includes('商品 6'))));
 console.log('PASS: default selection, combined input, search navigation keeps selection, pick list, record pagination, save/load, replay exact 6 records over 2 pages');
 app.exit(0);
}catch(e){console.error(e);const w=BrowserWindow.getAllWindows()[0];console.log(await w.webContents.executeJavaScript('document.getElementById("log").textContent'));console.log(await w.contentView.children.at(-1).webContents.executeJavaScript('({keys:window.keys,url:location.href,active:document.activeElement?.outerHTML,inputs:Array.from(document.querySelectorAll("input"),e=>({name:e.name,value:e.value}))})'));app.exit(1);}finally{server?.close();}});




