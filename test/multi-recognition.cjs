const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-multi-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),Module=require('node:module'),isolated=new Module(path.join(root,'engine','storage.js'));isolated.filename=path.join(root,'engine','storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);require('../main');
app.whenReady().then(async()=>{let server;try{
 const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const wc=win.webContents;const run=async c=>{try{return await wc.executeJavaScript(c);}catch(e){throw Error(c+' : '+e.message);}};const wait=async(fn)=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('timeout');};
 server=http.createServer((req,res)=>{res.setHeader('content-type','text/html;charset=utf-8');res.end(`<body><div id="categories">${['今日推荐','稳定Plus','Claude专区','接码专区','官方代充','其他服务'].map(t=>'<button>'+t+'</button>').join('')}</div><div id="products">${[1,2,3].map(i=>'<article style="display:inline-block;width:180px;margin:10px"><h3>商品 '+i+'</h3><p>用于测试商品名称与价格的列表</p><b>'+i*10+'</b><a href="/detail/'+i+'">详情</a></article>').join('')}</div><button id="more">加载更多</button><a id="next" href="/two">下一页</a></body>`);});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 await run(`$('urlInput').value=${JSON.stringify(url)};go()`);await run(`$('btnGuide').click()`);const page=win.contentView.children.find(v=>v.webContents).webContents;await wait(()=>page.executeJavaScript(`!!document.querySelector('[data-guide-action=detect]')`));await page.executeJavaScript(`document.querySelector('[data-guide-action=detect]').click()`);await wait(()=>page.executeJavaScript(`!!document.querySelector('[data-guide-action=stop-detect]')`));await wait(()=>run(`!!recognitionDraft`));
 assert.equal(await run('saveCurrentTask(true)'),false);
 await page.executeJavaScript(`document.querySelector('#__v6-guide>div button').click()`);
 await run('syncRecognitionGuide()');assert.equal(await page.executeJavaScript(`document.querySelector('#__v6-guide').dataset.collapsed`),'true');
 await page.executeJavaScript(`document.querySelector('#__v6-guide>div button').click()`);
 const product=await run(`candidates.findIndex(c=>c.count===3&&c.fields.length>1)`),category=await run(`candidates.findIndex(c=>c.count===6&&c.fields.length===1)`);assert.ok(product>=0);assert.ok(category>=0);
 
 await run(`selectCandidate(${product})`);await wait(()=>run(`$('dataTable').querySelectorAll('tbody tr').length===3`));
 assert.ok(await page.executeJavaScript(`document.querySelector('#__v6-guide').textContent.includes('切换识别结果')`));
 const count=await run('candidates.length');for(let i=0;i<count;i++){if(await run(`candidateIndex===${category}`))break;await page.executeJavaScript(`document.querySelector('[data-guide-action=next]').click()`);await new Promise(r=>setTimeout(r,100));}
 await wait(()=>run(`$('dataTable').querySelectorAll('tbody tr').length===6`));assert.equal(await run(`document.querySelector('#dataTable tbody tr td').textContent`),'今日推荐');assert.ok(await page.executeJavaScript(`document.querySelector('#categories button').hasAttribute('data-v6hl')`));
 fs.mkdirSync(path.join(__dirname,'shots'),{recursive:true});fs.writeFileSync(path.join(__dirname,'shots','multi-recognition-page.png'),(await page.capturePage()).toPNG());
 await page.executeJavaScript(`document.querySelector('[data-guide-action=modify-more]').click()`);await wait(()=>run(`guidePick==='recognition-more'&&picking`));await page.executeJavaScript(`document.querySelector('#more').click()`);await wait(()=>run(`!picking&&guidePick===null`));assert.equal(await run(`recognitionMoreSelector`),'button#more');
 await page.executeJavaScript(`document.querySelector('[data-guide-action=generate]').click()`);await wait(()=>run('recognitionDraft===null'));await wait(()=>page.executeJavaScript(`!!document.querySelector('[data-guide-action=pagination]')`));
 assert.equal(await run(`document.querySelector('#btnDetect')`),null);assert.equal(await run(`document.querySelector('#btnCopyNode')`),null);
 await run(`selectNode('extract');document.querySelector('[data-id="'+selectedNode+'"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:1300,clientY:240}))`);
 assert.deepEqual(await run(`Array.from($('nodeContext').children).map(b=>b.textContent)`),['修改名称','复制','粘贴','剪切','上移','下移','删除','撤销']);
 await run(`Array.from($('nodeContext').children).find(b=>b.textContent==='复制').click();showNodeMenu({clientX:1300,clientY:240});Array.from($('nodeContext').children).find(b=>b.textContent==='粘贴').click()`);
 assert.equal(await run(`Workflow.find(cfg.flow,selectedNode).siblings.length`),2);
 const copiedId=await run('selectedNode');
 await run(`showNodeMenu({clientX:1300,clientY:240});Array.from($('nodeContext').children).find(b=>b.textContent==='上移').click()`);
 assert.equal(await run(`Workflow.find(cfg.flow,selectedNode).siblings[0].id`),copiedId);
 await run(`showNodeMenu({clientX:1300,clientY:240});Array.from($('nodeContext').children).find(b=>b.textContent==='下移').click()`);
 assert.equal(await run(`Workflow.find(cfg.flow,selectedNode).siblings[1].id`),copiedId);
 await run(`undoNode();undoNode()`);

 await run(`showNodeMenu({clientX:1300,clientY:240});Array.from($('nodeContext').children).find(b=>b.textContent==='撤销').click()`);
 fs.writeFileSync(path.join(__dirname,'shots','guide-generated.png'),(await page.capturePage()).toPNG());
 await page.executeJavaScript(`document.querySelector('[data-guide-action=pagination]').click()`);await wait(()=>run(`guidePick==='pagination'&&picking`));await page.executeJavaScript(`document.querySelector('#next').click()`);await wait(()=>run(`guidePick===null&&!picking&&currentNode().type==='pages'`));assert.equal(await run('cfg.nextSel.selector'),'a#next');
 await page.executeJavaScript(`document.querySelector('[data-guide-action=scroll]').click()`);await wait(()=>run(`currentNode().type==='scrollLoop'`));
 await page.executeJavaScript(`document.querySelector('[data-guide-action=more]').click()`);await wait(()=>run(`guidePick==='more'&&picking`));await page.executeJavaScript(`document.querySelector('#more').click()`);await wait(()=>run(`!picking&&currentNode().type==='loadMore'`));assert.equal(await run('currentNode().params.selector'),'button#more');
 await run(`$('optScroll').checked=false;currentNode().params.count=1;startScrape()`);await wait(()=>run(`!scraping&&$('progressFill').style.width==='100%'`));const result=await run(`cmd('run-results',{})`);assert.equal(result.total,6);assert.equal(result.rows[0][0],'今日推荐');
 const beforeCancel=await run('JSON.stringify(cfg)');await run(`$('btnGuide').click()`);await wait(()=>page.executeJavaScript(`!!document.querySelector('[data-guide-action=detect]')`));await page.executeJavaScript(`document.querySelector('[data-guide-action=detect]').click()`);await wait(()=>page.executeJavaScript(`!!document.querySelector('[data-guide-action=stop-detect]')`));await page.executeJavaScript(`document.querySelector('[data-guide-action=stop-detect]').click()`);await wait(()=>run('!detecting'));assert.equal(await run('JSON.stringify(cfg)'),beforeCancel);
 console.log('PASS: sidebar recognition/action controls removed, native page progress and cancellation preserve config; context copy/paste/undo');
 console.log('PASS: distinct product/category recognition; floating candidate switching changes highlights/preview; generate selected candidate; guided pagination/scroll/load-more picking; exact 6 selected rows collected');app.exit(0);
}catch(e){console.error(e);app.exit(1);}finally{server?.close();}});
