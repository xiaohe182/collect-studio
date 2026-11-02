'use strict';
const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),pc=require('../engine/pagecode');
app.whenReady().then(async()=>{try{
  const w=new BrowserWindow({show:false,width:800,height:600,webPreferences:{backgroundThrottling:false}});
  for(const identified of [true,false]){
    const html='<div id="sc" style="height:160px;overflow:auto;position:relative;overflow-anchor:none"><div style="height:480px"></div><article style="position:absolute;top:0;height:80px">相同业务值</article><article style="position:absolute;top:0;height:80px">相同业务值</article></div><script>const sc=document.getElementById("sc"),rows=[...document.querySelectorAll("article")];function render(){const first=Math.min(4,Math.floor(sc.scrollTop/80));rows.forEach((row,i)=>{row.style.transform="translateY("+(first+i)*80+"px)";'+(identified?'row.dataset.rowId="logical-"+(first+i);':'')+'});}sc.onscroll=render;window.renderTimer=setInterval(render,20);render();</script>';
    await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    const cfg={list:{type:'css',selector:'article'},fields:[{name:'值',rel:':scope',type:'text'}]};
    const result=await w.webContents.executeJavaScript('('+pc.scrollCollectCode()+')('+JSON.stringify(cfg)+',{dedupe:false,maxRows:100,scrollWait:150,maxScrollSec:3})');
    await w.webContents.executeJavaScript('clearInterval(renderTimer)');
    if(result.rows.length!==6)console.log('RECYCLED',result,await w.webContents.executeJavaScript('({top:sc.scrollTop,height:sc.scrollHeight,rows:rows.map(row=>({id:row.dataset.rowId,top:row.getBoundingClientRect().top,transform:row.style.transform}))})'));
    assert.equal(result.rows.length,6,(identified?'有行ID':'无行ID但有稳定逻辑位置')+'的复用DOM应保留6条等值业务行');
    assert.ok(result.rows.every(row=>row[0]==='相同业务值'));
  }
  console.log('PASS recycled equal-value list keeps all six logical rows, with IDs and with transformed row positions');app.exit(0);
}catch(error){console.error(error);app.exit(1);}});
