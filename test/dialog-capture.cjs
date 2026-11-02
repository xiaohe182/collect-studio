'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-dialog-capture-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),isolated=new Module(path.join(root,'engine/storage.js'));isolated.filename=path.join(root,'engine/storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);require('../main');
app.whenReady().then(async()=>{try{
  const w=BrowserWindow.getAllWindows()[0];if(w.webContents.isLoading())await new Promise(r=>w.webContents.once('did-finish-load',r));
  const page=w.contentView.children[0];await page.webContents.loadURL('data:text/html,<p>采集结果背景</p>');
  page.webContents.capturePage=async()=>{throw Error('Current display surface not available for capture');};
  const result=await w.webContents.executeJavaScript("v6api.invoke('panel-dialog',{open:true,keepPage:true})");
  assert.equal(result.ok,true,'无截图表面时仍应正常打开结果面板');assert.equal(result.backdrop,null);
  const closed=await w.webContents.executeJavaScript("v6api.invoke('panel-dialog',{open:false})");assert.equal(closed.ok,true);
  console.log('PASS optional backdrop capture cannot block opening or closing a dialog');app.exit(0);
}catch(error){console.error(error);app.exit(1);}});
