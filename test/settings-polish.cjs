const {app,BrowserWindow,dialog}=require('electron'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-delete-'));app.setPath('userData',path.join(root,'profile'));const storage=require('../engine/storage'),Module=require('module'),m=new Module(path.join(root,'engine/storage.js'));m.filename=path.join(root,'engine/storage.js');m._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),m.filename);Object.assign(storage,m.exports);for(const id of ['active','old1','old2'])storage.saveTask({id,name:id,url:'https://example.com',flow:[],fields:[]});let answer=0;dialog.showMessageBox=async()=>({response:answer});require('../main');
app.whenReady().then(async()=>{try{
const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const run=s=>win.webContents.executeJavaScript(s);const page=win.contentView.children[0].webContents;const code=require('../engine/pagecode');
await page.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<table style="width:90%;background:#cef"><tr><td>表格背景</td></tr></table>'));
await page.executeJavaScript(`(${code.opTipCode()})('show')`);
await page.executeJavaScript('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await new Promise(r=>setTimeout(r,200));
const rect=await page.executeJavaScript(`(()=>{const r=document.querySelector('#__v6-optip .hd').getBoundingClientRect();return {x:Math.round(r.x+60),y:Math.round(r.y+16)}})()`);
page.sendInputEvent({type:'mouseMove',x:rect.x,y:rect.y});await new Promise(r=>setTimeout(r,50));page.sendInputEvent({type:'mouseDown',x:rect.x,y:rect.y,button:'left',clickCount:1});await new Promise(r=>setTimeout(r,50));page.sendInputEvent({type:'mouseMove',x:rect.x-180,y:rect.y+90,button:'left'});await new Promise(r=>setTimeout(r,50));page.sendInputEvent({type:'mouseUp',x:rect.x-180,y:rect.y+90,button:'left',clickCount:1});await new Promise(r=>setTimeout(r,150));
const position=await page.executeJavaScript('window.__v6TipPosition');assert.ok(position);assert.ok(position.y>50);assert.equal(await page.executeJavaScript('!!window.__v6tipCollapsed'),false);
await page.executeJavaScript(`document.querySelector('#__v6-optip .hd').click()`);assert.equal(await page.executeJavaScript('window.__v6tipCollapsed'),true);assert.equal(await page.executeJavaScript('window.__v6TipPosition.x'),position.x);
await page.executeJavaScript(`(${code.guideCode()})({phase:'idle'})`);assert.equal(await page.executeJavaScript(`document.querySelector('#__v6-guide').style.left`),position.x+'px');
await run("openPanelDialog('tableFieldsDialog')");assert.equal(await run("!!$('tablePageBackdrop')&&$('tablePageBackdrop').src.startsWith('data:image/png')"),true);assert.equal(await run("$('tableFieldsDialog').open"),true);
await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(__dirname,'shots','field-mask.png'),(await win.webContents.capturePage()).toPNG());await run("$('tableFieldsDialog').close()");await new Promise(r=>setTimeout(r,100));assert.equal(await run("!!$('tablePageBackdrop')"),false);
await run("settingsDirty=false;cfg={fields:[],flow:[Workflow.node('input')]};selectNode(cfg.flow[0].id);document.querySelector('[data-tab=adv]').click()").catch(async()=>{await run("$('tab-basic').hidden=true;$('tab-adv').hidden=false")});
assert.equal(await run("getComputedStyle($('flowTaskLabel')).fontSize"),'12px');
await run("$('resultsDialog').classList.add('is-running')");assert.equal(await run("getComputedStyle(document.querySelector('.run-ring'),'::before').animationName"),'run-orbit');
await run("$('resultsDialog').classList.remove('is-running')");assert.equal(await run("getComputedStyle(document.querySelector('.run-ring'),'::before').animationName"),'none');
await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await new Promise(r=>setTimeout(r,100));fs.writeFileSync(path.join(__dirname,'shots','settings-polish.png'),(await win.webContents.capturePage()).toPNG());
console.log('PASS native pointer drag, no accidental collapse, position retained, table mask background cleanup, 12px task name, running/completed arc');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});




