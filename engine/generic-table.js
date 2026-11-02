'use strict';
// Browser-only structural probe and collector, serialized into the target page.
// Table columns are rebound to their headers when the page recreates DOM IDs.
async function genericTable(input,opts={}) {
  const discovering=typeof input==='string',cfg=discovering?null:input;
  const xpath=el=>{const parts=[];while(el?.nodeType===1){let n=1;for(let p=el.previousElementSibling;p;p=p.previousElementSibling)if(p.localName===el.localName)n++;parts.unshift(el.localName+'['+n+']');el=el.parentElement;}return '/'+parts.join('/');};
  const locate=path=>document.evaluate(path,document,null,9,null).singleNodeValue;
  const text=el=>(el?.textContent||'').replace(/\s+/g,' ').trim();
  const visible=el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden';
  // VXE keeps empty fixed-column copies and virtual pre-render placeholders in
  // layout. A bounding rectangle alone does not mean the cell contains data.
  const usableCell=cell=>visible(cell)&&!cell.matches('.fixed--hidden,.is--progress');
  const cells=row=>Array.from(row.children).filter(usableCell);
  const rowLike=row=>{const cs=cells(row);if(cs.length<2)return false;const boxes=cs.map(c=>c.getBoundingClientRect());return boxes.every(b=>Math.abs(b.top-boxes[0].top)<Math.max(5,boxes[0].height*.5))&&boxes.at(-1).left>boxes[0].left;};
  const el=discovering?document.querySelector(input):locate(cfg.list.tableRoot);
  if(!el)throw Error('所选表格不存在，请重新选择');
  let root=el,rowsPath=cfg?.list.selector,headersPath=cfg?.list.headersPath;
  if(discovering){
    let row=el.closest('tr,[role="row"]');
    if(!row){for(let p=el;p&&p!==document.body;p=p.parentElement){if(rowLike(p)&&Array.from(p.parentElement.children).filter(rowLike).length>=2){row=p;break;}}}
    if(!row){const candidate=el.querySelector('tr,[role="row"]');if(candidate)row=candidate;}
    if(!row)throw Error('未确认表格行列结构。请选择数据单元格；Canvas 或图片表格暂不支持 DOM 提取');
    root=row.closest('.vxe-table,[role="grid"],[role="table"]')||row.closest('table')||row.parentElement;
    // Some grids render headers and body in separate native tables.
    if(!root.querySelector('th,[role="columnheader"]')){
      for(let p=root.parentElement;p&&p!==document.body;p=p.parentElement){
        if(p.querySelector('th,[role="columnheader"]')){root=p;break;}
        if(p.querySelectorAll('table,[role="grid"]').length>3)break;
      }
    }
    const semantic=!!row.matches('tr,[role="row"]');
    rowsPath=semantic?xpath(root)+'//*[self::tr or @role="row"][not(.//th or .//*[@role="columnheader"])][td or *[@role="cell" or @role="gridcell"]]':xpath(row.parentElement)+'/*';
    headersPath=xpath(root)+'//*[self::th or @role="columnheader"]';
  }
  const component=root.closest('.vxe-table');
  const query=path=>{const found=document.evaluate(path,document,null,7,null);return Array.from({length:found.snapshotLength},(_,i)=>found.snapshotItem(i)).filter(visible);};
  const rows=()=>query(rowsPath).filter(row=>cells(row).length>0);
  let sample=component?.querySelector('.vxe-table--main-wrapper tr[rowid]')||rows()[0];if(!sample)throw Error('表格没有可识别的数据行，请先加载数据');
  const candidates=[];
  for(let p=sample.parentElement;p;p=p.parentElement){
    const cs=getComputedStyle(p);
    if(/auto|scroll|hidden/.test(cs.overflowX+' '+cs.overflowY)||p===document.scrollingElement)candidates.push(p);
    if(p===document.body)break;
  }
  const sx=candidates.find(p=>p.scrollWidth>p.clientWidth+1)||null;
  const sy=candidates.find(p=>p.scrollHeight>p.clientHeight+1)||null;
  const initial={x:sx?.scrollLeft||0,y:sy?.scrollTop||0};
  const fields=discovering?[]:cfg.fields,columns=new Map(),records=new Map();
  const rowLimit=Math.max(1,Number(opts.maxRows)||200000);
  const limited=()=>!discovering&&records.size>=rowLimit;
  const fieldByColumn=new Map(fields.map(field=>[field.tableColumn,field]));
  const fieldsByHeader=new Map();
  for(const field of fields){const label=field.tableHeader||field.name;fieldsByHeader.set(label,[...(fieldsByHeader.get(label)||[]),field]);}
  const idAttrs=['aria-colindex','data-col-key','data-column-key','col-id','colid'];
  const rowAttrs=['aria-rowindex','data-row-key','data-row-id','row-id','rowid'];
  const attrKey=(el,attrs)=>{for(const attr of attrs){const value=el.getAttribute(attr);if(value!==null&&value!=='')return attr+':'+value;}return null;};
  const position=(el,axis,sc)=>Math.round((el.getBoundingClientRect()[axis]-(sc?.getBoundingClientRect()[axis]||0)+(sc?(axis==='left'?sc.scrollLeft:sc.scrollTop):0))*10)/10;
  const columnKey=cell=>attrKey(cell,idAttrs)||'x:'+position(cell,'left',sx);
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const started=performance.now();let rounds=0,repairPass=0;
  const generation=discovering?null:(window.__v6CollectionGeneration=(window.__v6CollectionGeneration||0)+1);
  const obsolete=()=>!discovering&&window.__v6CollectionGeneration!==generation;
  const expired=()=>!discovering&&performance.now()-started>=(opts.maxScrollSec??120)*1000;
  const stopped=()=>!discovering&&(window.__v6collectStopped||obsolete());
  const previewId=Date.now()+':'+Math.random();let previewSent=0;
  const previewDirty=new Map();
  function publishPreview(force=false){
    if(discovering||obsolete()||!previewDirty.size||(!force&&performance.now()-previewSent<150))return;
    window.__v6?.send('collect-preview',{id:previewId,fields,rows:[...previewDirty].map(([id,record])=>({id,values:fields.map(f=>record[f.tableColumn]??'')}))});
    previewDirty.clear();previewSent=performance.now();
  }
  if(!discovering)window.__v6collectStopped=false;
  async function move(sc,axis,value){
    if(stopped())return false;
    // Mutation delivery is independent of row count: do not serialize every
    // cell repeatedly while waiting for the grid to finish rendering.
    const movedAt=performance.now();let changed=movedAt;
    const observer=new MutationObserver(()=>{changed=performance.now();});
    observer.observe(component||root,{subtree:true,childList:true,characterData:true,attributes:true});
    const old=sc[axis];
    try{
      sc[axis]=value;sc.dispatchEvent(new Event('scroll'));
      let remaining=Math.max(Number(opts.scrollWait??150),repairPass?250:0);
      while(remaining>0&&!stopped()&&!expired()){const n=Math.min(30,remaining);await sleep(n);remaining-=n;}
      const deadline=performance.now()+600;
      while(!stopped()&&!expired()&&performance.now()<deadline&&(performance.now()-movedAt<90||performance.now()-changed<60))await sleep(30);
      rounds++;return Math.abs(sc[axis]-old)>.1;
    }finally{observer.disconnect();}
  }
  function read(cell,field){
    if(!cell)return '';
    const urls=[...new Set(Array.from(cell.querySelectorAll('img'),img=>{const url=img.getAttribute('data-src')||img.getAttribute('data-original')||img.currentSrc||img.getAttribute('src');return url?new URL(url,document.baseURI).href:'';}).filter(Boolean))];
    if(field?.type==='img')return urls.join('\n');
    if(field?.type==='href')return Array.from(cell.querySelectorAll('a[href]'),a=>a.href).join('\n');
    if(field?.type==='html')return cell.outerHTML;if(field?.type==='innerHtml')return cell.innerHTML;
    if(field?.type==='value')return cell.querySelector('input,textarea,select')?.value||'';
    return [text(cell),...urls].filter(Boolean).join('\n');
  }
  function harvest(){
    const headers=component?Array.from(component.querySelectorAll('.vxe-table--header th[colid]')).filter(h=>visible(h)&&h.closest('.vxe-table')===component):query(headersPath),current=rows();
    // Existing rules may target only the main body. Fixed columns render their
    // visible cells in separate rows with the same row ID.
    const fixedRows=new Map();
    if(component)for(const row of component.querySelectorAll('.vxe-table--body tr[rowid]')){
      if(!visible(row)||row.closest('.vxe-table')!==component)continue;
      const id=attrKey(row,rowAttrs);if(!fixedRows.has(id))fixedRows.set(id,[]);fixedRows.get(id).push(row);
    }
    const headerByKey=new Map(),keysByHeader=new Map();
    for(const head of headers){const key=columnKey(head),label=text(head);headerByKey.set(key,head);if(!keysByHeader.has(label))keysByHeader.set(label,new Set());keysByHeader.get(label).add(key);}
    for(const row of current){
      const id=attrKey(row,rowAttrs)||'y:'+position(row,'top',sy);
      if(!records.has(id)&&limited())continue;
      let changed=!records.has(id);
      const record=records.get(id)||{};records.set(id,record);
      const rowCells=fixedRows.has(id)?fixedRows.get(id).flatMap(cells):cells(row);
      for(const [index,cell] of rowCells.entries()){
        const liveKey=columnKey(cell),head=headerByKey.get(liveKey)||(!sx?headers[index]:null);
        if(component&&(cell.matches('.col--checkbox,.col--radio,.col--expand')||head?.matches('.col--checkbox,.col--radio,.col--expand')))continue;
        const header=text(head),matching=fieldsByHeader.get(header)||[];
        // Component IDs can change or overlap after navigation. Match the header
        // before considering the recorded ID, so columns cannot silently swap.
        const byId=fieldByColumn.get(liveKey);
        let field=null;
        if(matching.length===1&&keysByHeader.get(header)?.size===1)field=matching[0];
        else if(byId&&(!head||(byId.tableHeader||byId.name)===header))field=byId;
        const key=field?.tableColumn||(fieldByColumn.has(liveKey)?'unmapped:'+liveKey:liveKey);
        if(!columns.has(key)){
          const base=field?.name||header||'字段'+(columns.size+1);let name=base,n=2;
          while([...columns.values()].some(c=>c.name===name))name=base+' '+n++;
          columns.set(key,{name,tableColumn:key,tableHeader:header,type:cell.querySelector('img')?'img':'text',index,position:position(head||cell,'left',sx)});
        }
        const value=read(cell,field||columns.get(key));
        if(Object.hasOwn(record,key)&&record[key]!==value&&record[key]&&value)throw Error('滚动后行或列标识不稳定，无法确认数据归属；请为此表格选择稳定的行列标识');
        if(!Object.hasOwn(record,key)||record[key]!==value)changed=true;
        record[key]=value;
      }
      if(!discovering&&changed)previewDirty.set(id,record);
    }
    publishPreview();
  }
  const tolerance=1+1/(devicePixelRatio||1);
  const end=(sc,axis)=>!sc||(axis==='scrollLeft'?sc.scrollWidth-sc.clientWidth-sc.scrollLeft:sc.scrollHeight-sc.clientHeight-sc.scrollTop)<=tolerance;
  async function scanX(){
    if(sx)await move(sx,'scrollLeft',0);harvest();
    while(sx&&!end(sx,'scrollLeft')&&!stopped()){
      if(expired()||stopped())break;
      if(discovering&&performance.now()-started>60000)throw Error('表格扫描超过 60 秒，请等待页面稳定后重试');
      if(!await move(sx,'scrollLeft',sx.scrollLeft+Math.max(20,sx.clientWidth*.5))&&!stopped()&&!end(sx,'scrollLeft'))throw Error('检测到横向滚动区域，但无法移动，请检查遮罩或页面状态');
      harvest();
    }
  }
  let reason='完成表格扫描',incomplete=null;
  try{
    if(discovering){await scanX();fields.push(...[...columns.values()].sort((a,b)=>a.position-b.position));}
    else if(opts.scrollLoad===false||cfg.list.scanHidden===false){harvest();reason='已关闭滚动加载，仅提取当前渲染行';}
    else {
      for(repairPass=0;repairPass<3;repairPass++){
      if(repairPass){if(expired()||stopped())break;await sleep(250);if(stopped())break;}
      if(sy)await move(sy,'scrollTop',0);
      do{
        if(stopped())break;await scanX();
        window.__v6?.send('collect-progress',{rows:records.size,round:rounds,seconds:Math.round((performance.now()-started)/1000),atEnd:end(sx,'scrollLeft')&&end(sy,'scrollTop'),stable:0});
        if(limited()||end(sy,'scrollTop')&&end(sx,'scrollLeft'))break;
        if(expired()||stopped())break;
        if(sy&&!await move(sy,'scrollTop',sy.scrollTop+Math.max(20,sy.clientHeight*.5))&&!stopped()&&!end(sy,'scrollTop'))throw Error('检测到纵向滚动区域，但无法移动');
      }while(!stopped());
      if(stopped())reason='已停止';else if(expired()&&!(end(sy,'scrollTop')&&end(sx,'scrollLeft')))reason='达到滚动时间上限';else if(limited())reason='达到数据条数上限';
      if(reason==='完成表格扫描'||reason==='达到数据条数上限'){
        const missingColumns=fields.filter(f=>[...records.values()].some(record=>!Object.hasOwn(record,f.tableColumn))).map(f=>f.name);
        const rowCount=Number(root.getAttribute('aria-rowcount'));
        const headerRows=root.querySelectorAll('[role="row"]:has([role="columnheader"])').length;
        const expectedRows=rowCount>0&&!limited()?rowCount-headerRows:null;
        incomplete=missingColumns.length||expectedRows!==null&&records.size!==expectedRows?{missingColumns,expectedRows,actualRows:records.size}:null;
        if(!incomplete)break;
        if(repairPass<2){window.__v6?.send('collect-progress',{rows:records.size,round:rounds,seconds:Math.round((performance.now()-started)/1000),atEnd:false,stable:0,repair:repairPass+1});continue;}
      }
      break;
      }
      if(stopped())reason='已停止';
      else if(incomplete){
        incomplete.missingColumns=fields.filter(f=>[...records.values()].some(record=>!Object.hasOwn(record,f.tableColumn))).map(f=>f.name);
        incomplete.actualRows=records.size;
        const message=incomplete.missingColumns.length?'部分行未采全配置列：'+incomplete.missingColumns.join('、')+'；已自动补扫，请确认这些列已显示':('表格应有 '+incomplete.expectedRows+' 行，实际采到 '+records.size+' 行，已自动补扫');
        reason='表格扫描不完整';incomplete.error=message;
      }
    }
  }finally{publishPreview(true);if(discovering){if(sx)await move(sx,'scrollLeft',initial.x);if(sy)await move(sy,'scrollTop',initial.y);}}
  if(discovering){
    if(!fields.length)throw Error('未找到可采集的列');
    let owner=root,next=null;
    while(owner&&owner!==document.body){const matches=Array.from(owner.querySelectorAll('a,button,[role="button"]')).filter(n=>[text(n),n.getAttribute('aria-label'),n.getAttribute('title')].some(value=>/^(下一页|下页|next|next page)$/i.test(value||''))||n.getAttribute('rel')==='next');if(matches.length===1){next=matches[0];break;}owner=owner.parentElement;}
    return {list:{type:'xpath',selector:rowsPath,genericGrid:true,tableRoot:xpath(root),headersPath},fields,nextSel:next?{type:'xpath',selector:xpath(next)+'[not(@disabled) and not(@aria-disabled="true")]'}:null,virtual:!!(sx||sy)};
  }
  if(limited()&&!stopped()&&!incomplete&&reason!=='达到滚动时间上限')reason='达到数据条数上限';
  return {rows:[...records.values()].map(record=>fields.map(f=>record[f.tableColumn]??'')),fields,rounds,ms:performance.now()-started,reason,incomplete,error:incomplete?.error,verification:reason!=='完成表格扫描'?'本页未做完整性确认':(repairPass?'已自动补扫 '+repairPass+' 次；':'')+(Number(root.getAttribute('aria-rowcount'))>0?'已校验表格声明行数':'页面未声明总行数，已检查滚动边界与每行列完整性')};
}
module.exports={genericTable};
