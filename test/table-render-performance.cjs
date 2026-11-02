const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict');
const {genericTable}=require('../engine/generic-table');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-table-render-')));
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{backgroundThrottling:false}});try{
 const run=code=>w.webContents.executeJavaScript(code);
 const html='<div style="height:180px;overflow:auto"><table><thead><tr>'+Array.from({length:8},(_,c)=>'<th>C'+c+'</th>').join('')+'</tr></thead><tbody>'+Array.from({length:400},(_,r)=>'<tr>'+Array.from({length:8},(_,c)=>'<td>R'+r+'C'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
 await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
 const cfg=await run('('+genericTable.toString()+')("td")');
 const measure=async(fn)=>{
  await run('window.serializations=0;window.originalOuterHTML=window.originalOuterHTML||Object.getOwnPropertyDescriptor(Element.prototype,"outerHTML");Object.defineProperty(Element.prototype,"outerHTML",{configurable:true,get(){serializations++;return originalOuterHTML.get.call(this);},set:originalOuterHTML.set});true');
  const result=await run('('+fn.toString()+')('+JSON.stringify(cfg)+',{scrollWait:0,maxScrollSec:.35})');
  assert.equal(result.rows.length,400);assert.deepEqual(result.rows.at(-1),Array.from({length:8},(_,c)=>'R399C'+c));
  return {rows:result.rows.length,rounds:result.rounds,ms:Math.round(result.ms),fullRowSerializations:await run('serializations')};
 };
 if(process.env.V6_BASELINE_ENGINE)console.log('BASELINE',JSON.stringify(await measure(require(path.join(process.env.V6_BASELINE_ENGINE,'generic-table')).genericTable)));
 const current=await measure(genericTable);console.log('CURRENT',JSON.stringify(current));
 assert.equal(current.fullRowSerializations,0,'render readiness must not serialize the entire table every 30ms');
 console.log('PASS 400 x 8 cells retained with zero polling serialization of whole rows');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
