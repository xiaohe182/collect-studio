'use strict';
// Serialized into the page: never capture main-process variables here.
function inspectTarget(options) {
  let doc=document;
  if(options.inFrame){
    const frame=doc.evaluate(options.frameXPath,doc,null,9,null).singleNodeValue;
    if(!frame)return {exists:false};
    doc=frame.contentDocument;
    if(!doc)throw Error('无法访问 iframe 内容，请确认页面已加载且 iframe 与页面同源');
  }
  const css=options.path||(options.mode==='css'?options.selector:null);
  const el=css?doc.querySelector(css):doc.evaluate(options.xpath||options.selector,doc,null,9,null).singleNodeValue;
  if(!el)return {exists:false};
  const segments=[];let current=el;
  while(current?.nodeType===1){let index=1,sibling=current.previousElementSibling;while(sibling){if(sibling.localName===current.localName)index++;sibling=sibling.previousElementSibling;}segments.unshift(current.localName+'['+index+']');current=current.parentElement;}
  const repeated=(()=>{for(let p=el;p&&p!==doc.body;p=p.parentElement){if(p.children.length>=2&&p.parentElement?.children.length>=2&&Array.from(p.parentElement.children).filter(n=>n.children.length===p.children.length).length>=2)return true;}return false;})();
  return {exists:true,xpath:'/'+segments.join('/'),table:!!el.closest('table,[role="grid"],[role="table"]')||repeated,tag:el.tagName,text:(el.textContent||'').trim().slice(0,80)};
}
module.exports={inspectTarget};
