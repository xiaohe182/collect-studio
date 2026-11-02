const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),path=require('node:path');
app.whenReady().then(async()=>{try{
 const w=new BrowserWindow({show:false,width:1000,height:700});await w.loadURL('data:text/html,<div id="host" style="height:300px;width:800px;overflow:auto"></div>');
 await w.webContents.executeJavaScript(require('fs').readFileSync(path.join(__dirname,'../renderer/virtual-results.js'),'utf8'));
 await w.webContents.insertCSS(require('fs').readFileSync(path.join(__dirname,'../renderer/layout.css'),'utf8').replaceAll('#runResultsBody','#host'));
 await w.webContents.executeJavaScript('renderVirtualResults(host,Array.from({length:150},(_,i)=>({name:"F"+i})),Array.from({length:100},(_,i)=>Array.from({length:150},(_,c)=>i+":"+c)),200000)');
 assert.ok(await w.webContents.executeJavaScript('host.querySelectorAll("td").length')<200);
 await w.webContents.executeJavaScript('host.scrollTop=3200;host.scrollLeft=24000');await new Promise(r=>setTimeout(r,100));
 const result=await w.webContents.executeJavaScript('({cells:host.querySelectorAll("td").length,text:host.textContent})');assert.ok(result.cells<200);assert.ok(result.text.includes(':133'));
 console.log('PASS two-axis virtual result table: 150 columns, bounded cells, large row offset and scrolling');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
