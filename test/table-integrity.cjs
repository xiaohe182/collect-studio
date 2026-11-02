const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const {collectVirtualTable}=require('../engine/virtual-table');
app.setPath('userData',require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'v6-integrity-')));
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false});try{
await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<base href="https://example.test/catalog/"><div class="vxe-table"><div class="vxe-table--main-wrapper"><table class="vxe-table--header"><tr><th colid="name"><span class="vxe-cell--title">名称</span></th><th colid="photo"><span class="vxe-cell--title">图片</span></th></tr></table><div class="vxe-table--body-inner-wrapper" style="height:200px;overflow:auto"><table class="vxe-table--body"><tr rowid="1"><td colid="name">商品</td><td colid="photo"><img data-src="../a.jpg" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///w=="></td></tr><tr rowid="2"><td colid="name"></td><td colid="photo"></td></tr><tr rowid="3"><td colid="name">商品</td><td colid="photo"><img src="/b.jpg"><img src="/c.jpg"></td></tr></table></div></div></div>`));
const cfg={list:{selector:'//tr[@rowid]',virtualGrid:true},fields:[{name:'名称',virtualColumn:'名称',type:'text'},{name:'图片',virtualColumn:'图片',type:'text'}]};
const collect=(opts={})=>w.webContents.executeJavaScript(require('../engine/table-cell').readTableCell.toString()+';('+collectVirtualTable.toString()+')('+JSON.stringify(cfg)+','+JSON.stringify({scrollWait:0,maxScrollSec:10,...opts})+')');
const result=await collect();assert.equal(result.rows.length,3,'真实存在的空行不能被删除');
assert.deepEqual(result.rows,[['商品','https://example.test/a.jpg'],['',''],['商品','https://example.test/b.jpg\nhttps://example.test/c.jpg']]);
const preview=await w.webContents.executeJavaScript('('+require('../engine/pagecode').previewCode()+')('+JSON.stringify({...cfg,list:{...cfg.list,type:'xpath'}})+')');
assert.deepEqual(preview.data?.rows||preview.rows,result.rows,'预览与正式采集应使用相同图片规则');
const detected=await w.webContents.executeJavaScript('('+require('../engine/table-discovery').discoverTable.toString()+')('+JSON.stringify('td[colid="photo"]')+')');
assert.equal(detected.fields.find(f=>f.virtualColumn==='图片').type,'img');
await w.webContents.executeJavaScript(`window.moves=0;document.querySelector('.vxe-table--body-inner-wrapper').onscroll=()=>moves++;true`);
const visible=await collect({scrollLoad:false});assert.equal(visible.rows.length,3);assert.match(visible.reason,/已关闭滚动/);assert.equal(await w.webContents.executeJavaScript('moves'),0);
const limited=await collect({maxScrollSec:0});assert.equal(limited.rows.length,3);assert.equal(limited.reason,'达到滚动时间上限');
await w.webContents.executeJavaScript(`document.body.insertAdjacentHTML('beforeend','<div class="vxe-pager"><span class="vxe-pager--total">共 4 条</span><span class="vxe-pager--sizes">100条/页</span><button class="vxe-pager--num-btn is--active">1</button></div>')`);
const missing=await collect();assert.match(missing.error,/应有 4 行.*3 行/);assert.equal(missing.rows.length,3,'incomplete table returns the already collected values');
await w.webContents.executeJavaScript(`(()=>{let moves=0;document.querySelector('.vxe-table--body-inner-wrapper').onscroll=()=>{if(++moves===3)setTimeout(()=>document.querySelector('.vxe-table--body tbody').insertAdjacentHTML('beforeend','<tr rowid="4"><td colid="name">延迟行</td><td colid="photo"></td></tr>'),200);};})()`);
assert.equal((await collect()).rows.length,4,'补扫应收回延迟渲染的末行');
console.log('PASS: blank rows preserved; lazy/multiple images resolved; text-only pager prevents incomplete page');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});

