'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),pc=require('../engine/pagecode');
app.whenReady().then(async()=>{try{
  const w=new BrowserWindow({show:false});await w.loadURL('data:text/html,<article rowid="1"><a href="/detail/a">查看详情</a></article>');
  const fingerprint=virtualGrid=>w.webContents.executeJavaScript('('+pc.listFingerprintCode()+')('+JSON.stringify({list:{type:'css',selector:'article',virtualGrid}})+')');
  const first=await fingerprint(false);
  await w.webContents.executeJavaScript('document.querySelector("a").setAttribute("href","/detail/b")');
  assert.notDeepEqual((await fingerprint(false)).items,first.items,'相同链接文案但详情地址变化应识别为下一页');
  const virtual=await fingerprint(true);await w.webContents.executeJavaScript('document.querySelector("a").textContent="新业务值"');
  assert.notDeepEqual((await fingerprint(true)).items,virtual.items,'复用同一行ID的新数据应识别为下一页');
  console.log('PASS page fingerprints detect descendant link changes and recycled row IDs');app.exit(0);
}catch(error){console.error(error);app.exit(1);}});
