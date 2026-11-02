/* Render only the visible rows and columns of the current result page. */
function renderVirtualResults(host,fields,rows,offset){
  host._virtualCleanup?.();
  const height=36,width=180,numberWidth=64,headers=['序号',...fields.map(f=>f.name)];
  const table=document.createElement('table');table.className='virtual-results';
  table.style.width=(numberWidth+fields.length*width)+'px';table.style.height=((rows.length+1)*height)+'px';
  table.setAttribute('aria-rowcount',String(rows.length+1));table.setAttribute('aria-colcount',String(headers.length));
  const head=table.createTHead(),body=table.createTBody();host.append(table);
  let raf=0,last='';
  const draw=()=>{
    raf=0;if(!table.isConnected)return;
    const first=Math.max(0,Math.floor(host.scrollTop/height)-2),end=Math.min(rows.length,first+Math.ceil((host.clientHeight||300)/height)+5);
    const firstCol=Math.max(1,Math.floor((host.scrollLeft-numberWidth)/width)+1),lastCol=Math.min(headers.length,firstCol+Math.ceil((host.clientWidth||800)/width)+2);
    const key=[first,end,firstCol,lastCol].join(':');if(key===last)return;last=key;
    const columns=[0,...Array.from({length:Math.max(0,lastCol-firstCol)},(_,i)=>i+firstCol)];
    head.replaceChildren();body.replaceChildren();
    const create=(parent,values,index,isHead)=>{const tr=document.createElement('tr');tr.style.top=(isHead?0:(index+1)*height)+'px';tr.setAttribute('aria-rowindex',String(index+2));
      for(const col of columns){const cell=document.createElement(isHead?'th':'td');cell.textContent=String(values(col)??'');cell.style.left=(col?numberWidth+(col-1)*width:0)+'px';cell.style.width=(col?width:numberWidth)+'px';cell.setAttribute('aria-colindex',String(col+1));tr.append(cell);}parent.append(tr);};
    create(head,col=>headers[col],-1,true);
    for(let i=first;i<end;i++)create(body,col=>col?rows[i][col-1]:offset+i+1,i,false);
  };
  const schedule=()=>{if(!raf)raf=requestAnimationFrame(draw);};
  host.addEventListener('scroll',schedule,{passive:true});const observer=new ResizeObserver(schedule);observer.observe(host);
  host._virtualCleanup=()=>{host.removeEventListener('scroll',schedule);observer.disconnect();cancelAnimationFrame(raf);host._virtualCleanup=null;};
  draw();
}
