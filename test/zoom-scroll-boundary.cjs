const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const {collectVirtualTable}=require('../engine/virtual-table');
const {readTableCell}=require('../engine/table-cell');
app.setPath('userData',require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'v6-boundary-')));
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false});try{
  await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<div class="vxe-table"><div class="vxe-table--main-wrapper"><table class="vxe-table--header"><tr><th colid="c"><span class="vxe-cell--title">Column</span></th></tr></table><div class="vxe-table--body-inner-wrapper" style="width:101px;height:600px;overflow:scroll;border:1px solid"><div id="space" style="width:303px;height:303px"></div><table class="vxe-table--body"><tr rowid="1"><td colid="c">value</td></tr></table></div></div></div>`));
  const cfg={list:{selector:'//tr[@rowid]',virtualGrid:true},fields:[{name:'Column',virtualColumn:'Column'}]};
  const run=()=>w.webContents.executeJavaScript(readTableCell.toString()+';('+collectVirtualTable.toString()+')('+JSON.stringify(cfg)+',{scrollWait:0,maxScrollSec:20})');
  for(const zoom of [.25,.3,.5,.8,1]){
    w.webContents.setZoomFactor(zoom);await new Promise(r=>setTimeout(r,150));
    const geometry=await w.webContents.executeJavaScript(`(()=>{const sc=document.querySelector('.vxe-table--body-inner-wrapper');for(let width=300;width<316;width++){document.getElementById('space').style.width=width+'px';sc.scrollTo(100000,100000);if(sc.scrollWidth-sc.clientWidth-sc.scrollLeft>1)break;}sc.scrollTo(100000,100000);return {zoom:devicePixelRatio,x:sc.scrollWidth-sc.clientWidth-sc.scrollLeft,y:sc.scrollHeight-sc.clientHeight-sc.scrollTop};})()`);
    console.log('boundary',zoom,geometry);
    const result=await run();assert.deepEqual(result.rows,[['value']]);assert.equal(result.reason,'完成双向虚拟表格扫描');
  }
  w.webContents.setZoomFactor(.25);await new Promise(r=>setTimeout(r,150));
  // Reproduce rounded dimensions exceeding the browser's reachable endpoint.
  await w.webContents.executeJavaScript(`(()=>{const sc=document.querySelector('.vxe-table--body-inner-wrapper');const width=sc.scrollWidth,height=sc.scrollHeight;Object.defineProperties(sc,{scrollWidth:{configurable:true,get:()=>width+4},scrollHeight:{configurable:true,get:()=>height+4}});})()`);
  const oldBoundary=collectVirtualTable.toString().replace("if(stopped()||nearEnd('x'))break;","if(stopped())break;");
  await assert.rejects(w.webContents.executeJavaScript(readTableCell.toString()+';('+oldBoundary+')('+JSON.stringify(cfg)+',{scrollWait:0,maxScrollSec:20})'),/横向滚动未移动/);
  assert.deepEqual((await run()).rows,[['value']]);
  await w.webContents.executeJavaScript(`(()=>{const sc=document.querySelector('.vxe-table--body-inner-wrapper');delete sc.scrollWidth;delete sc.scrollHeight;})()`);
  // A genuinely blocked scroller must still fail, even if the visible cells look complete.
  await w.webContents.executeJavaScript(`(()=>{const sc=document.querySelector('.vxe-table--body-inner-wrapper');sc.scrollTo(0,0);sc.scrollTo=()=>{};})()`);
  await assert.rejects(run(),/横向滚动未移动/);
  console.log('PASS: native zoom boundaries and genuinely blocked scrolling');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
