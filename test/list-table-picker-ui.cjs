const {app,BrowserWindow,dialog}=require('electron'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-delete-'));app.setPath('userData',path.join(root,'profile'));const storage=require('../engine/storage'),Module=require('module'),m=new Module(path.join(root,'engine/storage.js'));m.filename=path.join(root,'engine/storage.js');m._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),m.filename);Object.assign(storage,m.exports);for(const id of ['active','old1','old2'])storage.saveTask({id,name:id,url:'https://example.com',flow:[],fields:[]});let answer=0;dialog.showMessageBox=async()=>({response:answer});require('../main');
app.whenReady().then(async()=>{try{const w=BrowserWindow.getAllWindows()[0];await new Promise(r=>w.webContents.once('did-finish-load',r));const run=s=>w.webContents.executeJavaScript(s);const page=w.contentView.children[0].webContents;
await page.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<table><thead><tr><th>编号</th><th>名称</th></tr></thead><tbody><tr><td>1</td><td>商品A</td></tr><tr><td>2</td><td>商品B</td></tr></tbody></table>'));
await run("cfg.flow=[Workflow.node('list')];cfg.flow[0].params={list:{type:'xpath',selector:''}};cfg.fields=[];settingsDirty=false;selectNode(cfg.flow[0].id);markSettingsDirty()");
const listId=await run('selectedNode');
await run("$('listSelector').parentElement.querySelector('button').click()");
await new Promise(r=>setTimeout(r,150));
await page.executeJavaScript("document.querySelector('td').click()");
for(let i=0;i<50;i++){if(await run('!!wholeTableDraft'))break;await new Promise(r=>setTimeout(r,100));}
assert.equal(await run('wholeTableDraft.fields.length'),2);
assert.equal(await run('wholeTableDraft.listNodeId'),listId);
await run("$('tableFieldsApply').click()");
assert.equal(await run('cfg.flow.length'),1);
assert.equal(await run('cfg.flow[0].id'),listId);
assert.equal(await run('cfg.flow[0].children.length'),1);
assert.equal(await run('cfg.flow[0].params.list.selector.length>0'),true);
assert.equal(await run('cfg.list.selector===cfg.flow[0].params.list.selector'),true);
assert.equal(await run('cfg.fields.length'),2);
await run("$('btnApplySettings').onclick()");assert.equal(await run('settingsDirty'),false);
const preview=await run("api.invoke('preview-page',cfg)");
assert.equal(preview.ok,true,JSON.stringify(preview));
assert.deepEqual(preview.data.rows,[['1','商品A'],['2','商品B']]);
const empty=await run("api.invoke('preview-page',{list:{type:'xpath',selector:''},fields:[]})");
assert.equal(empty.ok,false);assert.match(empty.error,/请选择|请先通过列表/);assert.doesNotMatch(empty.error,/evaluate/);
console.log('PASS list XPath icon -> cell -> fields -> existing list retained -> nonempty XPath -> apply');app.exit(0);}catch(e){console.error(e);app.exit(1);}});



