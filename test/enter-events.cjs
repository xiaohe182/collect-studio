const {app,BrowserWindow,WebContentsView}=require('electron'),assert=require('node:assert/strict');
const {executeInput}=require('../engine/input-action');
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false});const view=new WebContentsView({webPreferences:{backgroundThrottling:false}});win.contentView.addChildView(view);view.setVisible(false);const wc=view.webContents;try{
 for(const form of [true,false]){
 await wc.loadURL('data:text/html,'+encodeURIComponent((form?'<form>':'<div>')+'<input id="password" type="password">'+(form?'</form>':'</div>')));
 await wc.executeJavaScript(`window.events=[];window.logins=0;document.querySelector('form')?.addEventListener('submit',e=>e.preventDefault());for(const type of ['keydown','keypress','keyup'])document.querySelector('input').addEventListener(type,e=>{events.push({type:e.type,key:e.key,code:e.keyCode,trusted:e.isTrusted});if(e.type==='keyup'&&e.keyCode===13&&e.isTrusted)logins++;});`);
 const result=await executeInput(wc,{selector:'#password',mode:'css',value:'test',enter:true},{fields:[]});assert.equal(result.ok,true);
 const state=await wc.executeJavaScript('({events,logins})');assert.equal(state.logins,1,JSON.stringify(state));assert.deepEqual(state.events.map(e=>e.type),['keydown','keypress','keyup']);assert.ok(state.events.every(e=>e.trusted&&e.key==='Enter'&&e.code===13));
 }
 await wc.loadURL('data:text/html,<form><input id="password"><input name="city"><button>submit</button></form>');
 await wc.executeJavaScript('window.submits=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();submits++;};void 0');
 await executeInput(wc,{selector:'input[name=city]',value:'test',enter:true},{fields:[]});
 assert.equal(await wc.executeJavaScript('submits'),1,'native form must submit exactly once');
 await wc.executeJavaScript(`window.prevented=0;document.querySelector('input[name=city]').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();prevented++;}};void 0`);
 wc.debugger.attach('1.3');
 await executeInput(wc,{selector:'input[name=city]',value:'test',enter:true},{fields:[]});
 assert.equal(wc.debugger.isAttached(),true,'keep an existing debugger connection');wc.debugger.detach();
 assert.deepEqual(await wc.executeJavaScript('({prevented,submits})'),{prevented:1,submits:1},'respect keydown preventDefault without manual form submission');
 console.log('PASS: hidden execution page receives trusted Enter down/press/up exactly once, including keyCode 13 and keyup login, with and without form');wc.close();app.exit(0);
}catch(e){console.error(e);wc.close();app.exit(1);}});

