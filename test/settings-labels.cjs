const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-settings-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),Module=require('module'),m=new Module(path.join(root,'engine/storage.js'));m.filename=path.join(root,'engine/storage.js');m._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),m.filename);Object.assign(storage,m.exports);require('../main');
app.whenReady().then(async()=>{try{
 const w=BrowserWindow.getAllWindows()[0];await new Promise(r=>w.webContents.once('did-finish-load',r));
 const result=await w.webContents.executeJavaScript(`(()=>{
 cfg={url:'https://example.com',fields:[],flow:['open','click','input','condition','wait','next','pages','list','extract'].map(type=>({id:type,type,name:type,params:{}}))};
 const checks=[];for(const n of cfg.flow){selectNode(n.id);checks.push({type:n.type,hidden:document.getElementById('fieldList').closest('section').hidden});}
 selectNode('condition');const condition=[...nodeExtra.querySelectorAll('label')].map(x=>x.textContent);const suffix=nodeExtra.querySelector('[data-param=timeout]').parentElement.className;
 selectNode('open');const openLabel=nodeExtra.querySelector('[data-param=timeout]').closest('label').textContent;
 return {checks,condition,suffix,openLabel,taskSuffix:optLoadTimeout.parentElement.textContent};
 })()`);
 for(const c of result.checks)assert.equal(c.hidden,c.type!=='extract',c.type);
 assert.ok(result.condition.includes('比较值'));assert.ok(result.condition.includes('等待条件成立s'));assert.equal(result.suffix,'input-unit');assert.equal(result.openLabel,'页面加载超时s');assert.equal(result.taskSuffix,'s');
 console.log('PASS node-specific fields and concise labels with second suffix');app.exit(0);
 }catch(e){console.error(e);app.exit(1);}});
