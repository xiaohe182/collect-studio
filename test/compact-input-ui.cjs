const {app,BrowserWindow,dialog}=require('electron'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-delete-'));app.setPath('userData',path.join(root,'profile'));const storage=require('../engine/storage'),Module=require('module'),m=new Module(path.join(root,'engine/storage.js'));m.filename=path.join(root,'engine/storage.js');m._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),m.filename);Object.assign(storage,m.exports);for(const id of ['active','old1','old2'])storage.saveTask({id,name:id,url:'https://example.com',flow:[],fields:[]});let answer=0;dialog.showMessageBox=async()=>({response:answer});require('../main');
app.whenReady().then(async()=>{try{
const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const run=s=>win.webContents.executeJavaScript(s);
await run(`settingsDirty=false;cfg={fields:[],flow:[Workflow.node('input')]};cfg.flow[0].params={selector:'//input[@id="a"]',mode:'xpath',value:'first',enter:true};selectNode(cfg.flow[0].id)`);
assert.equal(await run("document.querySelector('.input-text-item textarea').value"),'first');
await run("document.querySelector('.input-text-add').click()");
assert.equal(await run('cfg.flow[0].params.entries.length'),2);
assert.equal(await run('cfg.flow[0].params.entries[0].value'),'first');
await run(`const section=document.querySelectorAll('.input-text-item')[1];const input=section.querySelector('input:not([type=checkbox])');input.value='//input[@id="b"]';input.dispatchEvent(new Event('change',{bubbles:true}));const text=section.querySelector('textarea');text.value='second';text.dispatchEvent(new Event('change',{bubbles:true}));`);
assert.equal(await run('cfg.flow[0].params.entries[1].value'),'second');
assert.equal(await run("!!$('tab-adv').querySelector('[data-param=enter]')"),true);
await run("$('btnApplySettings').onclick()");assert.equal(await run('settingsDirty'),false);
await run("selectNode(cfg.flow[0].id)");assert.equal(await run("document.querySelectorAll('.input-text-item').length"),2);
await run(`document.querySelector('.flow-insert').click()`);
assert.deepEqual(await run("[...document.querySelectorAll('[data-insert-type]')].map(e=>e.dataset.insertType)"),['list','scrollLoop','click','extract','open','back','hover','select','input','captcha','condition']);
await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await new Promise(r=>setTimeout(r,150));fs.mkdirSync(path.join(__dirname,'shots'),{recursive:true});fs.writeFileSync(path.join(__dirname,'shots','compact-menu.png'),(await win.webContents.capturePage()).toPNG());
await run(`$('nodeContext').hidden=true;const select=document.createElement('select');select.id='testSelect';select.style.cssText='position:fixed;right:20px;top:100px;width:180px';for(let i=0;i<30;i++)select.add(new Option('选项'+i,''+i));document.body.append(select);select.addEventListener('change',()=>window.changedValue=select.value);select.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));`);
assert.equal(await run("!!document.querySelector('.select-options')"),true);
assert.equal(await run("getComputedStyle(document.querySelector('.select-options'),'::-webkit-scrollbar').width"),'6px');
await run("document.querySelectorAll('.select-options button')[4].click()");assert.equal(await run('window.changedValue'),'4');
await run("$('testSelect').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));document.querySelector('.select-options').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
assert.equal(await run('selectPopup'),null);
await run("document.querySelectorAll('.input-text-remove')[1].click()");assert.equal(await run('cfg.flow[0].params.entries.length'),1);assert.equal(await run('cfg.flow[0].params.entries[0].value'),'first');
console.log('PASS multi-input migration/add/edit/remove/apply, exact menu, custom select mouse/keyboard/change and 6px scrollbar');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});

