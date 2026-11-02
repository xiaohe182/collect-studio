const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-message-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),Module=require('node:module'),isolated=new Module(path.join(root,'engine','storage.js'));isolated.filename=path.join(root,'engine','storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);require('../main');
app.whenReady().then(async()=>{try{
 const win=BrowserWindow.getAllWindows()[0];await new Promise(r=>win.webContents.once('did-finish-load',r));const run=c=>win.webContents.executeJavaScript(c);const page=win.contentView.children.find(v=>v.webContents).webContents;
 await page.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<div class="el-message-box"><button onclick="window.clicked=true">覆盖</button></div>'));
 await run(`cfg.flow=[Workflow.node('condition')];selectNode(cfg.flow[0].id);document.querySelector('#nodeExtra .node-pick').click()`);
 await new Promise(r=>setTimeout(r,250));
 await page.executeJavaScript(`document.querySelector('.el-message-box button').click()`);
 await new Promise(r=>setTimeout(r,250));
 assert.equal(await page.executeJavaScript('!!window.clicked'),false);
 assert.equal(await run(`document.querySelector('#nodeExtra [data-param=mode]').value`),'xpath');
 assert.ok((await run(`document.querySelector('#nodeExtra [data-param=selector]').value`)).includes('覆盖'));
 assert.equal(await run(`cfg.flow[0].params.selector`),undefined);
 await run(`document.querySelector('#nodeExtra .node-apply').click()`);
 assert.ok((await run('cfg.flow[0].params.selector')).includes('覆盖'));
 assert.equal(await run('cfg.flow[0].params.mode'),'xpath');
 for(const type of ['click','input','hover','select','loadMore','scrollLoop','captcha']){
  await run(`cfg.flow=[Workflow.node('${type}')];selectNode(cfg.flow[0].id)`);
  assert.equal(await run(`document.querySelector('#nodeExtra .xpath-picker button').textContent`),'');
  assert.equal(await run(`document.querySelector('#nodeExtra [data-param=mode]')?.closest('label').hidden??true`),true);
  await run(`document.querySelector('#nodeExtra .xpath-picker button').click()`);await new Promise(r=>setTimeout(r,100));
  await page.executeJavaScript(`document.querySelector('.el-message-box button').click()`);await new Promise(r=>setTimeout(r,100));
  await run(`document.querySelector('#nodeExtra .node-apply').click()`);
  assert.equal(await run('cfg.flow[0].params.mode'),'xpath',type);
  assert.ok((await run('cfg.flow[0].params.selector')).includes('覆盖'),type);
 }
 console.log('PASS: condition/click/input/hover/select/loadMore/scroll/captcha icon pickers; no visible CSS dropdown; XPath saved on Apply');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
