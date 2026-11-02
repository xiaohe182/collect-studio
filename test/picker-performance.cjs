const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),pc=require('../engine/pagecode');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-perf-')));
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{backgroundThrottling:false}});try{
 await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<div id="list" style="padding:60px">'+Array.from({length:2000},(_,i)=>`<article><h3>商品${i}</h3><span>￥99</span></article>`).join('')+'</div>'));
 const result=await win.webContents.executeJavaScript(`(async()=>{
  window.__v6={send:()=>{}};(${pc.pickCode()})(true);
  let scans=0,hits=0;const original=Element.prototype.querySelectorAll,points=document.elementsFromPoint.bind(document);
  Element.prototype.querySelectorAll=function(sel){if(sel==='*')scans++;return original.call(this,sel)};document.elementsFromPoint=(...args)=>{hits++;return points(...args)};
  const start=performance.now();for(let i=0;i<300;i++)document.querySelector('#list').dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:20+i%30,clientY:20}));
  const dispatchMs=performance.now()-start;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
  const clickStart=performance.now();document.querySelector('#list').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true,clientX:25,clientY:25}));
  const answer={dispatchMs,clickMs:performance.now()-clickStart,scans,hits};(${pc.pickCode()})(false);return answer;
 })()`);
 console.log(JSON.stringify(result));assert.equal(result.scans,0,'hover must not enumerate all descendants');assert.ok(result.hits<=2,'pointer events coalesced per frame');assert.ok(result.dispatchMs<200,'event dispatch responsive');assert.ok(result.clickMs<500,'initial container selection responsive');
 console.log('PASS: 2000 cards, 300 pointer events, bounded per-frame hit testing');
 const lifecycle=await win.webContents.executeJavaScript(`(async()=>{
   let count=0;window.__v6={send:type=>{if(type==='pick')count++}};
   for(let i=0;i<100;i++){(${pc.pickCode()})(true);document.querySelector('#list').dispatchEvent(new MouseEvent('mousemove',{bubbles:true,clientX:30,clientY:30}));(${pc.pickCode()})(false);}
   await new Promise(r=>requestAnimationFrame(r));
   const leftover=document.querySelectorAll('#__v6-selection').length;
   (${pc.pickCode()})(true);document.querySelector('h3').click();
   const active=document.querySelectorAll('#__v6-selection').length;
   window.scrollTo(0,500);window.dispatchEvent(new Event('scroll'));
   (${pc.pickCode()})(false);
   return {count,active,leftover,selected:document.querySelectorAll('[data-v6-selected]').length};
 })()`);
 assert.deepEqual(lifecycle,{count:1,active:1,leftover:0,selected:0});console.log('PASS: 100 enable/disable cycles, one click handler, no remaining menu or selection');
 win.destroy();app.exit(0);
}catch(e){console.error(e);win.destroy();app.exit(1);}});
