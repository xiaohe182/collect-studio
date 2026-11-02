const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),pc=require('../engine/pagecode');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-depth-')));
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1000,height:700});try{
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<style>article{position:relative;width:250px;height:350px;margin:40px}h3{margin:0}img{width:150px;height:120px}a.cover{position:absolute;inset:0;z-index:2}span{display:inline-block}</style><article><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E"><div><h3 id="title">商品名称</h3><span id="price">￥99</span><span id="stock">有货</span></div><a class="cover" href="#"></a></article>`));
 const wc=win.webContents;await wc.executeJavaScript(`window.__v6={send:()=>{}};(${pc.pickCode()})(true)`);
 async function clickAt(sel){await wc.executeJavaScript(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();document.querySelector('.cover').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:r.x+5,clientY:r.y+5}));})()`);}
 await clickAt('#price');assert.equal(await wc.executeJavaScript(`document.querySelector('[data-v6-selected]').id`),'price','transparent overlay must not hide price');
 await clickAt('img');assert.equal(await wc.executeJavaScript(`document.querySelector('[data-v6-selected]').tagName`),'IMG');
 await wc.executeJavaScript(`document.querySelector('article').click();document.querySelector('[data-action=fields]').click()`);
 assert.equal(await wc.executeJavaScript(`document.querySelectorAll('[data-v6-selected]').length`),4,'all nested fields individually highlighted');
 await clickAt('#title');assert.equal(await wc.executeJavaScript(`document.querySelectorAll('[data-v6-selected]').length`),1);
 await wc.executeJavaScript(`document.querySelector('[data-action=action-captcha]').click()`);
 const style=await wc.executeJavaScript(`(()=>{const s=getComputedStyle(document.querySelector('#__v6-selection select')),b=getComputedStyle(document.querySelector('#__v6-selection button'));return {height:s.minHeight,font:s.fontSize,color:s.color,radius:s.borderRadius,border:s.borderTopColor,button:b.minHeight}})()`);
 assert.equal(style.height,'30px');assert.equal(style.font,'12px');assert.equal(style.color,'rgb(33, 28, 21)');assert.equal(style.radius,'4px');assert.equal(style.button,'30px');
 await wc.executeJavaScript(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
 fs.mkdirSync(path.join(__dirname,'shots'),{recursive:true});fs.writeFileSync(path.join(__dirname,'shots','picker-controls.png'),(await wc.capturePage()).toPNG());
 console.log('PASS: covered price/image/text separately selectable, nested fields expanded, controls match sidebar tokens');win.destroy();app.exit(0);
}catch(e){console.error(e);win.destroy();app.exit(1);}});
