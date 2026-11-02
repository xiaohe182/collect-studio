const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),pc=require('../engine/pagecode');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-fields-')));
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false});try{
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<section id="products">'+[1,2,3].map(i=>`<article class="card"><h3>商品${i}</h3><b>￥${i}</b><span>库存${i}</span></article>`).join('')+'</section>'));
 const run=c=>win.webContents.executeJavaScript(c);await run(`window.events=[];window.__v6={send:(type,payload)=>events.push({type,payload})};(${pc.pickCode()})(true);document.querySelector('h3').click();document.querySelector('b').click();document.querySelector('span').click()`);
 assert.equal(await run(`document.querySelectorAll('[data-v6-selected]').length`),3);
 await run(`document.querySelector('span').click()`);assert.equal(await run(`document.querySelectorAll('[data-v6-selected]').length`),2);
 await run(`document.querySelector('[data-action=extract-auto]').click()`);
 let event=await run(`events.findLast(e=>e.type==='pick-action').payload`);
 let result=await run(`(${pc.resolvePickCode()})(${JSON.stringify(event.path)},'extract-auto',{},${JSON.stringify(event.selectionList)})`);
 assert.deepEqual(result.samples,[['商品1','￥1']]);
 await run(`(${pc.pickCode()})(true);document.querySelector('h3').click();document.querySelector('b').click();document.querySelector('[data-action=list]').click()`);
 assert.equal(await run(`document.querySelectorAll('[data-v6-selected]').length`),6);
 await run(`document.querySelector('[data-action=extract-auto]').click()`);event=await run(`events.findLast(e=>e.type==='pick-action').payload`);
 result=await run(`(${pc.resolvePickCode()})(${JSON.stringify(event.path)},'extract-auto',{},${JSON.stringify(event.selectionList)})`);
 assert.deepEqual(result.samples,[['商品1','￥1'],['商品2','￥2'],['商品3','￥3']]);
 console.log('PASS: additive clicks, toggle off, two separate fields, similar records produce 3 rows x 2 fields');win.destroy();app.exit(0);
}catch(e){console.error(e);win.destroy();app.exit(1);}});
