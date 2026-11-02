'use strict';
// Injected into the page. Merge recycled cells by rowid and header label.
async function collectVirtualTable(cfg,opts={}) {
  const first=document.evaluate(cfg.list.selector,document,null,9,null).singleNodeValue;
  const table=first?.closest('.vxe-table');
  if(!table)throw Error('未找到 VXE 表格，请重新选择列表');
  const main=table.querySelector('.vxe-table--main-wrapper');
  const sc=main?.querySelector('.vxe-table--body-inner-wrapper')||main?.querySelector('.vxe-table--body-wrapper');
  if(!sc)throw Error('未找到表格内部滚动区域');
  sc.style.overflowAnchor='none';
  const started=Date.now(),limit=(opts.maxScrollSec??120)*1000;
  const records=new Map(),headers=new Map();let rounds=0,reason='完成双向虚拟表格扫描';
  const rowLimit=Math.max(1,Number(opts.maxRows)||200000);
  const fieldByName=new Map((cfg.fields||[]).map(f=>[f.virtualColumn||f.name,f]));
  window.__v6collectStopped=false;
  const sleep=async ms=>{const end=Date.now()+ms;while(!window.__v6collectStopped&&Date.now()<end)await new Promise(r=>setTimeout(r,Math.min(30,end-Date.now())));};
  const text=e=>(e?.textContent||'').replace(/\s+/g,' ').trim();
  function expectedRows(){
    let owner=table.parentElement;
    while(owner&&!owner.querySelector('.vxe-pager'))owner=owner.parentElement;
    const pager=owner?.querySelector('.vxe-pager');
    const total=Number(text(pager?.querySelector('.vxe-pager--total')).replace(/[,，\s]/g,'').match(/\d+/)?.[0]);
    const sizes=pager?.querySelector('.vxe-pager--sizes');
    const size=parseInt(sizes?.querySelector('input')?.value||text(sizes),10);
    const page=Number(text(pager?.querySelector('.vxe-pager--num-btn.is--active'))||pager?.querySelector('.vxe-pager--goto input')?.value);
    return Number.isFinite(total)&&size>0&&page>0?Math.min(size,Math.max(0,total-(page-1)*size)):null;
  }
  let verificationPass=false;
  // Scroll offsets are fractional CSS pixels; width/height are rounded integers.
  // At 25% zoom one physical pixel spans four CSS pixels. Only tolerate this
  // rounding after actually attempting to scroll, never skip the last cells.
  const edgeTolerance=()=>1+1/(window.devicePixelRatio||1);
  const nearEnd=axis=>axis==='x'
    ?sc.scrollWidth-sc.clientWidth-sc.scrollLeft<=edgeTolerance()
    :sc.scrollHeight-sc.clientHeight-sc.scrollTop<=edgeTolerance();
  const stopped=()=>window.__v6collectStopped||Date.now()-started>=limit;
  async function move(x,y){
    if(window.__v6collectStopped)return;
    sc.scrollTo({left:x,top:y,behavior:'instant'});
    sc.dispatchEvent(new Event('scroll'));
    await sleep(Number(opts.scrollWait??200));
    if(verificationPass)await sleep(250);
    
    let prior='',stable=0;
    for(let i=0;i<15&&!stopped();i++){
      const signature=main.querySelector('.vxe-table--body')?.outerHTML||'';
      if(signature===prior){if(++stable>=2)break;}else stable=0;
      prior=signature;await sleep(50);
    }
  }
  function harvest(){
    const colNames=new Map();
    for(const th of table.querySelectorAll('.vxe-table--header th[colid]')){
      if(th.classList.contains('col--checkbox')||th.classList.contains('col--seq'))continue;
      const name=text(th.querySelector('.vxe-cell--title'));if(!name||name==='操作'||name==='订单走向图')continue;
      const id=th.getAttribute('colid');colNames.set(id,name);headers.set(name,true);
    }
    for(const tr of table.querySelectorAll('.vxe-table--body tr[rowid]')){
      const id=tr.getAttribute('rowid');if(!id)continue;
      let row=records.get(id);
      if(!row&&records.size>=rowLimit)continue;
      for(const td of tr.querySelectorAll('td[colid]')){
        const name=colNames.get(td.getAttribute('colid'));if(!name||td.classList.contains('fixed--hidden'))continue;
        if(!row){row={};records.set(id,row);}
        const field=fieldByName.get(name);
        const value=readTableCell(td,field);
        if(value||!Object.hasOwn(row,name))row[name]=value;
      }
    }
  }
  if(opts.scrollLoad===false||limit===0)harvest();
  if(opts.scrollLoad!==false)await move(0,0);
  for(let pass=0;opts.scrollLoad!==false&&pass<2&&!stopped();pass++){
  while(!stopped()){
    const y=sc.scrollTop;
    await move(0,y);harvest();
    while(sc.scrollLeft+sc.clientWidth<sc.scrollWidth-1&&!stopped()){
      const old=sc.scrollLeft;await move(old+Math.max(40,sc.clientWidth*.5),y);harvest();rounds++;
      if(sc.scrollLeft===old){
        if(stopped()||nearEnd('x'))break;
        throw Error('表格横向滚动未移动，已停止以避免漏列；当前位置 '+sc.scrollLeft+'，剩余 '+(sc.scrollWidth-sc.clientWidth-sc.scrollLeft).toFixed(1)+' 像素');
      }
    }
    window.__v6?.send('collect-progress',{round:rounds,rows:records.size,seconds:Math.round((Date.now()-started)/1000),atEnd:sc.scrollTop+sc.clientHeight>=sc.scrollHeight-3,stable:0});
    if(records.size>=rowLimit||sc.scrollTop+sc.clientHeight>=sc.scrollHeight-1)break;
    if(stopped())break;
    await move(0,y+Math.max(20,sc.clientHeight*.5));rounds++;
    if(sc.scrollTop===y){
      if(stopped()||nearEnd('y'))break;
      throw Error('表格纵向滚动未移动，已停止以避免漏行；当前位置 '+sc.scrollTop+'，剩余 '+(sc.scrollHeight-sc.clientHeight-sc.scrollTop).toFixed(1)+' 像素');
    }
  }
  const expected=expectedRows();
  const incomplete=Array.from(records.values()).some(row=>(cfg.fields||[]).some(f=>!Object.hasOwn(row,f.virtualColumn||f.name)));
  if(records.size>=rowLimit||(expected===null||records.size===expected)&&!incomplete)break;
  if(pass===0&&!stopped()){
    verificationPass=true;
    await move(0,0);
  }
  }
  if(window.__v6collectStopped)reason='已停止';else if(Date.now()-started>=limit)reason='达到滚动时间上限';
  else if(records.size>=rowLimit)reason='达到数据条数上限';
  if(opts.scrollLoad===false&&!window.__v6collectStopped&&records.size<rowLimit)reason='已关闭滚动加载，仅提取当前渲染行';
  const fields=cfg.fields?.length?cfg.fields:Object.keys(Object.fromEntries(headers)).map(name=>({name,virtualColumn:name,type:'text'}));
  const rows=Array.from(records.values());
  let error;
  if(reason==='完成双向虚拟表格扫描'||reason==='达到数据条数上限'){
    const expected=expectedRows();
    if(expected!==null&&records.size<rowLimit){
      if(rows.length!==expected)error='虚拟表格本页应有 '+expected+' 行，实际采到 '+rows.length+' 行，已停止翻页以避免漏采';
    }
    const missing=fields.filter(f=>!headers.has(f.virtualColumn||f.name));
    if(missing.length)error='表格未找到配置列：'+missing.map(f=>f.name).join('、');
    const incomplete=rows.find(row=>fields.some(f=>!Object.hasOwn(row,f.virtualColumn||f.name)));
    if(incomplete)error='虚拟表格存在未扫描完整的行，已停止翻页；累计 '+rows.length+' 行；缺少列：'+fields.filter(f=>!Object.hasOwn(incomplete,f.virtualColumn||f.name)).map(f=>f.name).join('、');
    if(error)reason='表格扫描不完整';else await move(0,0);
  }
  return {rows:rows.map(row=>fields.map(f=>row[f.virtualColumn||f.name]||'')),fields,rounds,ms:Date.now()-started,reason,error};
}
module.exports={collectVirtualTable};

