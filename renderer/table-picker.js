let wholeTableDraft=null,tableScanBusy=false;
async function selectWholeTable(path,listNodeId=null){
  if(tableScanBusy||scraping||detecting)return;
  if(settingsDirty&&!listNodeId){toast('请先应用当前配置，再选择整张表格');return;}
  tableScanBusy=true;wholeTableDraft=null;
  await setPicking(false);$('tableFieldsChoices').replaceChildren();$('tableScanStatus').textContent='正在扫描表格，自动查找横向隐藏的列…';$('tableFieldsApply').disabled=true;$('tableAutoNextLabel').hidden=true;$('tableFieldsAll').checked=true;
  await openPanelDialog('tableFieldsDialog');
  try{
    const r=await cmd('discover-table',{path});if(!$('tableFieldsDialog').open)return;
    if(!r.ok){$('tableScanStatus').textContent=r.error||'表格识别失败';return;}
    wholeTableDraft={...r.data,listNodeId};
    $('tableScanStatus').textContent=(r.data.list.genericGrid?'通用表格识别':r.data.virtual?'虚拟表格':'普通表格')+'：已识别 '+r.data.fields.length+' 列，请勾选需要采集的字段。';
    r.data.fields.forEach((f,i)=>{const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=true;input.dataset.fieldIndex=i;label.append(input,document.createTextNode(f.name));$('tableFieldsChoices').append(label);});
    $('tableAutoNextLabel').hidden=!r.data.nextSel;$('tableAutoNext').checked=!!r.data.nextSel;$('tableFieldsApply').disabled=false;
  }finally{tableScanBusy=false;}
}
$('tableFieldsAll').onchange=()=>{for(const el of $('tableFieldsChoices').querySelectorAll('input'))el.checked=$('tableFieldsAll').checked;};
$('tableFieldsCancel').onclick=()=>$('tableFieldsDialog').close();
$('tableFieldsApply').onclick=()=>{
  if(!wholeTableDraft||tableScanBusy)return;
  const fields=[...$('tableFieldsChoices').querySelectorAll('input:checked')].map(el=>({...wholeTableDraft.fields[Number(el.dataset.fieldIndex)],__on:true}));
  if(!fields.length){toast('请至少选择一个字段');return;}
  const existing=wholeTableDraft.listNodeId?Workflow.find(cfg.flow,wholeTableDraft.listNodeId):null;
  if(wholeTableDraft.listNodeId&&!existing){toast('原列表节点已删除，请重新选择');return;}
  if(settingsDirty)captureNodeDraft();
  rememberFlow();
  const freeze=nodes=>nodes.forEach(n=>{if(n.type==='extract'&&!n.params.fields)n.params.fields=structuredClone(cfg.fields);if(n.children)freeze(n.children);});freeze(ensureFlow());
  const list=existing?.node||Workflow.node('list');
  const extract=list.children?.find(n=>n.type==='extract')||Workflow.node('extract');
  if(!existing)list.name='循环表格行';
  const previous=list.params?.list;
  const selectedList={...wholeTableDraft.list};
  const scrollEnabled=previous?.genericGrid?previous.scanHidden:previous?.virtualGrid;
  if(typeof scrollEnabled==='boolean'){
    if(selectedList.genericGrid)selectedList.scanHidden=scrollEnabled;else selectedList.virtualGrid=scrollEnabled;
  }
  list.params={...list.params,list:selectedList,timeout:list.params?.timeout??30};
  // Different table rows may have identical selected values. Preserve them by default.
  extract.name='提取表格字段';extract.params={...extract.params,fields,dedupe:extract.params?.dedupe??false};
  list.children||=[];if(!list.children.includes(extract))list.children.push(extract);
  const inPages=(nodes,inside=false)=>nodes.some(n=>n.id===list.id?inside:n.children&&inPages(n.children,inside||n.type==='pages'));
  let added=list;
  if($('tableAutoNext').checked&&wholeTableDraft.nextSel&&!inPages(cfg.flow)){const pages=Workflow.node('pages'),next=Workflow.node('next');pages.params={limitEnabled:false,mode:'xpath',selector:wholeTableDraft.nextSel.selector};next.params={mode:'xpath',selector:wholeTableDraft.nextSel.selector};pages.children=[list,next];added=pages;}
  if(existing)existing.siblings.splice(existing.index,1,added);
  else{const found=Workflow.find(cfg.flow,selectedNode);if(found)found.siblings.splice(found.index+1,0,added);else cfg.flow.push(added);}
  cfg.list=selectedList;cfg.fields=fields;if(wholeTableDraft.nextSel)cfg.nextSel=wholeTableDraft.nextSel;
  if(wholeTableDraft.virtual){$('optScroll').checked=true;cfg.opts={...cfg.opts,scrollLoad:true,maxScrollSec:180,scrollWait:150};restoreOptions(cfg.opts);}
  captureNodeDraft=()=>{};
  selectNode(extract.id);renderFields();markSettingsDirty();$('tableFieldsDialog').close();wholeTableDraft=null;toast('已生成表格采集步骤，点击底部应用后保存');
};
