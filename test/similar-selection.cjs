const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),pc=require('../engine/pagecode');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-similar-')));
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});try{
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<section id="products">'+[1,2,3].map(i=>`<article class="card"><div><h3>商品${i}</h3><b>￥${i}</b></div></article>`).join('')+'</section>'));
 const run=c=>win.webContents.executeJavaScript(c);await run(`window.events=[];window.__v6={send:(type,payload)=>events.push({type,payload})};(${pc.pickCode()})(true);document.querySelector('h3').click()`);
 assert.equal(await run(`document.querySelector('[data-action=list]').textContent`),'找出全部相似');
 await run(`document.querySelector('[data-action=list]').click()`);
 assert.equal(await run(`document.querySelectorAll('[data-v6-selected]').length`),3);
 assert.deepEqual(await run(`[...document.querySelectorAll('#__v6-selection [data-action]')].map(b=>b.textContent)`),['元素中数据内容','返回选择','取消']);
 assert.equal(await run(`events.filter(e=>e.type==='pick-action').length`),0);
 await run(`document.querySelector('[data-action=back]').click()`);assert.equal(await run(`document.querySelectorAll('[data-v6-selected]').length`),1);
 await run(`document.querySelector('[data-action=list]').click();document.querySelector('[data-action=extract-auto]').click()`);
 const event=await run(`events.find(e=>e.type==='pick-action').payload`);
 const result=await run(`(${pc.resolvePickCode()})(${JSON.stringify(event.path)},'extract-auto',{},${JSON.stringify(event.selectionList)})`);
 assert.equal(result.count,3);assert.deepEqual(result.samples,[['商品1'],['商品2'],['商品3']]);
 console.log('PASS: select -> find similar -> content extraction, nested titles, no premature rule write, back, exact three rows');win.destroy();app.exit(0);
}catch(e){console.error(e);win.destroy();app.exit(1);}});
