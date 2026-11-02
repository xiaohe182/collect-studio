'use strict';
const {BrowserWindow}=require('electron');
const fs=require('fs');
async function exportFlowPng(task,file){
  const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  try{
    await win.loadURL('about:blank');
    // Only names and structure are exported, never input values or credentials.
    const simplify=nodes=>(nodes||[]).map(n=>({name:n.name||n.type,enabled:n.enabled!==false,children:n.children?simplify(n.children):null}));
    const data={name:task.name||'未命名任务',group:task.group||'未分组',nodes:simplify(task.flow)};
    const result=await win.webContents.executeJavaScript('('+render.toString()+')('+JSON.stringify(data)+')');
    await fs.promises.writeFile(file,Buffer.from(result.png.split(',')[1],'base64'));
    return {width:result.width,height:result.height};
  }finally{win.destroy();}
}
function render(data){
  const width=360,scale=2,gap=34;
  // Match editor geometry. Nested nodes scale both dimensions together if needed.
  const nodeWidth=available=>Math.min(180,available);
  const nodeHeight=available=>32*nodeWidth(available)/180;
  const groupWidth=available=>Math.min(280,available);
  const measure=(nodes,available)=>gap+nodes.reduce((h,n)=>h+(n.children?32+measure(n.children,groupWidth(available)-24):nodeHeight(available))+gap,0);
  const height=124+measure(data.nodes,320)+50;
  if(height*scale>32760)throw Error('流程过长，超出单张高清 PNG 的尺寸限制');
  const canvas=document.createElement('canvas');canvas.width=width*scale;canvas.height=height*scale;
  const c=canvas.getContext('2d');c.scale(scale,scale);c.fillStyle='#fff';c.fillRect(0,0,width,height);
  function text(t,x,y,max,size=12,color='#333',bold=false){c.font=(bold?'600 ':'400 ')+size+'px "Microsoft YaHei",sans-serif';c.fillStyle=color;c.textAlign='center';let value=t;while(c.measureText(value).width>max&&value.length>1)value=value.slice(0,-2)+'…';c.fillText(value,x,y);}
  function rect(x,y,w,h,fill,stroke){c.beginPath();c.roundRect(x,y,w,h,3);c.fillStyle=fill;c.fill();c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}
  function arrow(y){c.strokeStyle='#d8dde4';c.beginPath();c.moveTo(width/2,y);c.lineTo(width/2,y+gap-4);c.stroke();c.fillStyle='#d8dde4';c.beginPath();c.moveTo(width/2-3,y+gap-5);c.lineTo(width/2+3,y+gap-5);c.lineTo(width/2,y+gap-1);c.fill();}
  text(data.name,width/2,35,width-48,16,'#333',true);text(data.group,width/2,59,width-48,12,'#758092');
  text('开始',width/2,101,100,12,'#3478f6');
  function draw(nodes,y,available){
    arrow(y);y+=gap;
    for(const n of nodes){
      const label=n.name+(n.enabled?'':'（已禁用）');
      if(n.children){const w=groupWidth(available),x=(width-w)/2,h=32+measure(n.children,w-24);rect(x,y,w,h,'#fff','#dfe3e8');rect(x,y,w,32,'#f8f9fb','#dfe3e8');text(label,width/2,y+21,w-24,12);draw(n.children,y+32,w-24);y+=h;}
      else{const w=nodeWidth(available),h=nodeHeight(available),ratio=w/180,x=(width-w)/2;rect(x,y,w,h,n.enabled?'#fafafa':'#f1f1f1','#dfe3e8');text(label,width/2,y+h/2+4*ratio,w-20*ratio,12*ratio,n.enabled?'#333':'#999');y+=h;}
      arrow(y);y+=gap;
    }return y;
  }
  const bottom=draw(data.nodes,112,320);text('结束',width/2,bottom+20,100,12,'#758092');
  const png=canvas.toDataURL('image/png');if(png==='data:,')throw Error('流程图片尺寸过大，生成失败');return {png,width:canvas.width,height:canvas.height};
}
module.exports={exportFlowPng};
