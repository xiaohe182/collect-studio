const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-node-settings-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),isolated=new Module(path.join(root,'engine/storage.js'));
isolated.filename=path.join(root,'engine/storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);require('../main');
app.whenReady().then(async()=>{try{
 const win=BrowserWindow.getAllWindows()[0];if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));const run=s=>win.webContents.executeJavaScript(s),failures=[];
 await win.contentView.children[0].webContents.loadURL('data:text/html,<article class="list-a"><b class="a">A</b></article><article class="list-b updated"><b class="b edited-b">B</b></article>');
 async function check(name,fn){try{await fn();console.log('PASS '+name);}catch(e){failures.push(name+': '+e.message);console.error('FAIL '+name+': '+e.message);}}
 const fixture=async()=>run(`settingsDirty=false;cfg={id:'scope-test',name:'节点归属测试',url:'https://example.com',list:null,fields:[],flow:[]};
  for(const key of ['a','b']){const list=Workflow.node('list'),extract=Workflow.node('extract');list.id='list-'+key;list.params.list={type:'css',selector:'.list-'+key};extract.id='extract-'+key;extract.params.fields=[{name:key.toUpperCase()+'字段',rel:'.'+key,type:'text'}];list.children=[extract];cfg.flow.push(list);}renderFields();selectNode('extract-a');`);
 await check('list/extract selection and edits stay in their own scope',async()=>{
  await fixture();await run(`selectNode('list-b')`);assert.deepEqual(await run(`({list:cfg.list.selector,fields:cfg.fields.map(f=>f.name)})`),{list:'.list-b',fields:['B字段']});
  assert.equal(await run(`$('fieldList').getClientRects().length===0`),true);
  await run(`selectNode('extract-b');const field=document.querySelector('.field-selector');field.value='.edited-b';field.dispatchEvent(new Event('change',{bubbles:true}));`);
  assert.deepEqual(await run(`cfg.flow.map(n=>n.children[0].params.fields[0].rel)`),['.a','.edited-b']);await run(`selectNode('extract-a')`);assert.equal(await run(`document.querySelector('.field-selector').value`),'.a');
  await run(`$('btnApplySettings').onclick()`);assert.equal(await run('saveCurrentTask(true)'),true);
  const saved=storage.getTask('scope-test');assert.deepEqual(saved.flow.map(n=>n.children[0].params.fields[0].rel),['.a','.edited-b']);
  await run(`settingsDirty=false;loadEditor(${JSON.stringify(saved)});selectNode('extract-b')`);assert.equal(await run(`document.querySelector('.field-selector').value`),'.edited-b');
  const rows=[];let error;await new (require('../engine/orchestrator').Scraper)(win.contentView.children[0],{cfg:saved,opts:{scrollLoad:false},onRows:r=>rows.push(...r),onError:e=>error=e}).run();
  assert.equal(error,undefined);assert.deepEqual(rows,[['A',''],['','B']]);
 });
 await check('new extraction node starts with its own empty fields',async()=>{
  await fixture();await run(`const fresh=Workflow.node('extract');cfg.flow[1].children.push(fresh);selectNode(fresh.id);$('btnAddField').click()`);
  assert.equal(await run(`currentNode().params.fields.length`),1);assert.equal(await run(`cfg.flow[0].children[0].params.fields[0].name`),'A字段');
 });
 await check('CSS edit/apply keeps its type and blank fields have useful guidance',async()=>{
  await fixture();await run(`selectNode('list-b')`);assert.equal(await run(`$('listMode').getClientRects().length>0`),true);
  await run(`$('listSelector').value='.list-b.updated';$('listSelector').dispatchEvent(new Event('change',{bubbles:true}));`);assert.equal(await run(`$('listMode').value`),'css');
  await run(`$('btnApplySettings').onclick()`);assert.equal(await run('settingsDirty'),false);assert.equal(await run(`cfg.flow[1].params.list.type`),'css');
  await run(`settingsDirty=false;cfg.flow[1].children[0].params.fields=[];selectNode('extract-b')`);
  assert.equal(await run(`$('btnAddField').getClientRects().length>0`),true);assert.match(await run(`$('fieldList').parentElement.textContent`),/尚未配置字段/);
  assert.equal(await run(`[...document.querySelectorAll('.card-t')].some(e=>e.textContent==='元素选择')`),false);
 });
 await check('inspection previews the current draft without replacing the applied list',async()=>{
  await fixture();await run(`selectNode('list-b');$('listSelector').value='.list-b.updated';$('listSelector').dispatchEvent(new Event('change',{bubbles:true}));`);
  await run(`$('btnInspectList').onclick()`);assert.match(await run(`$('listCheckStatus').textContent`),/匹配 1 条/);
  assert.equal(await run(`cfg.flow[1].params.list.selector`),'.list-b');assert.equal(await run(`$('dataTable').querySelector('tbody td').textContent`),'B');assert.equal(await run('settingsDirty'),true);
  await run(`selectNode('extract-b')`);assert.equal(await run(`$('dataTable').querySelector('tbody td')?.textContent`),'B','switching within one list keeps its valid preview');
 });
 await check('clear current next rule clears loop override and leaves other loops intact',async()=>{
  await run(`settingsDirty=false;const pages=Workflow.node('pages'),next=Workflow.node('next'),other=Workflow.node('pages'),otherNext=Workflow.node('next');pages.id='pages-a';next.id='next-a';pages.params={selector:'.loop-old',mode:'css'};next.params={selector:'.next-old',mode:'css'};pages.children=[next];other.params={selector:'.other-loop',mode:'css'};otherNext.params={selector:'.other-next',mode:'css'};other.children=[otherNext];cfg={id:'next-scope',url:'https://example.com',fields:[],nextSel:{type:'css',selector:'.legacy-next'},flow:[pages,other]};selectNode('next-a')`);
  assert.equal(await run(`$('btnClearNext').getClientRects().length>0`),true);await run(`$('btnClearNext').click()`);assert.equal(await run('settingsDirty'),true);await run(`$('btnApplySettings').onclick()`);
  assert.deepEqual(await run(`cfg.flow.map(n=>[n.params.selector,n.children[0].params.selector])`),[['',''],['.other-loop','.other-next']]);assert.equal(await run('settingsDirty'),false);
  assert.equal(await run('saveCurrentTask(true)'),true);assert.equal(storage.getTask('next-scope').flow[0].children[0].params.selector,'');
 });
 if(failures.length)throw Error(failures.join('\n'));app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
