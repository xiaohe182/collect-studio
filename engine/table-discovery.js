'use strict';
async function discoverTable(path){
  const el=document.querySelector(path);if(!el)throw Error('所选元素已变化，请重新选择');
  const vxe=el.closest('.vxe-table'),table=vxe||el.closest('table');if(!table)throw Error('请选择表格内的单元格');
  const xpath=e=>{const parts=[];while(e&&e.nodeType===1){let i=1;for(let n=e.previousElementSibling;n;n=n.previousElementSibling)if(n.tagName===e.tagName)i++;parts.unshift(e.tagName.toLowerCase()+'['+i+']');e=e.parentElement;}return '/'+parts.join('/');};
  const clean=e=>(e?.textContent||'').replace(/\s+/g,' ').trim();
  let owner=table.parentElement;while(owner&&owner!==document.body&&!owner.querySelector('.vxe-pager'))owner=owner.parentElement;
  const next=owner?.querySelector('.vxe-pager--next-btn');
  const nextSel=next?{type:'xpath',selector:xpath(next)+'[not(@disabled) and not(contains(@class,"is--disabled"))]'}:null;
  if(!vxe){
    const headers=[...(table.tHead?.rows?.[table.tHead.rows.length-1]?.cells||table.querySelector('tr')?.cells||[])];
    const hasHeader=!!table.tHead||headers.some(h=>h.tagName==='TH');
    const fields=headers.map((h,index)=>({name:(hasHeader?clean(h):'')||'字段'+(index+1),index,type:Array.from(table.querySelectorAll('tbody tr')).some(row=>row.children[index]?.querySelector('img'))?'img':'text'})).filter(f=>!['操作','序号'].includes(f.name));
    if(table.querySelector('[colspan]:not([colspan="1"]),[rowspan]:not([rowspan="1"])'))throw Error('此表格含合并单元格，暂不支持自动字段对齐');
    const selector=xpath(table)+'/tbody/tr[td]'+(table.tHead||!hasHeader?'':'[position()>1]');
    return {list:{type:'xpath',selector},fields,nextSel:null,virtual:false};
  }
  const main=vxe.querySelector('.vxe-table--main-wrapper'),sc=main?.querySelector('.vxe-table--body-inner-wrapper')||main?.querySelector('.vxe-table--body-wrapper');
  if(!sc)throw Error('未找到虚拟表格滚动区域');
  const x=sc.scrollLeft,y=sc.scrollTop,fields=new Map(),names=new Set(),started=Date.now();
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  async function move(left){sc.scrollTo({left,top:y,behavior:'instant'});sc.dispatchEvent(new Event('scroll'));await sleep(180);let prev='',stable=0;for(let i=0;i<20;i++){const signature=main.querySelector('.vxe-table--header')?.outerHTML||'';if(signature===prev){if(++stable>=2)break;}else stable=0;prev=signature;await sleep(50);}}
  try{
    await move(0);
    while(true){
      for(const th of vxe.querySelectorAll('.vxe-table--header th[colid]')){
        if(th.classList.contains('col--checkbox')||th.classList.contains('col--seq'))continue;
        const name=clean(th.querySelector('.vxe-cell--title')),id=th.getAttribute('colid');
        if(!name||['操作','订单走向图','序号'].includes(name)||fields.has(id))continue;
        if(names.has(name))throw Error('存在同名表头“'+name+'”，请先调整表头名称再识别');
        const hasImage=Array.from(vxe.querySelectorAll('td[colid]')).some(td=>td.getAttribute('colid')===id&&td.querySelector('img'));
        names.add(name);fields.set(id,{name,virtualColumn:name,type:hasImage?'img':'text'});
      }
      if(sc.scrollLeft+sc.clientWidth>=sc.scrollWidth-3)break;
      if(Date.now()-started>60000)throw Error('扫描表格列超时，请等待表格加载后重试');
      const old=sc.scrollLeft;await move(old+Math.max(40,sc.clientWidth*.5));if(sc.scrollLeft===old)throw Error('横向滚动未移动，无法确认所有列');
    }
  }finally{await move(x);}
  if(!fields.size)throw Error('没有识别到表头，请先显示表格列');
  return {list:{type:'xpath',selector:xpath(main)+'//tr[@rowid]',virtualGrid:true},fields:[...fields.values()],nextSel,virtual:true};
}
module.exports={discoverTable};
