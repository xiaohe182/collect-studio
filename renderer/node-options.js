function addInputUnit(input,unit){
  const wrap=document.createElement('span');wrap.className='input-unit';input.replaceWith(wrap);wrap.append(input);
  const suffix=document.createElement('span');suffix.className='input-unit-suffix';suffix.textContent=unit;wrap.append(suffix);input.setAttribute('aria-label',(input.closest('label')?.firstChild?.textContent||'时间')+' ('+unit+')');
}
let captureNodeDraft=()=>{};
let applyCurrentNode=async()=>true;
// 节点页签与任务级选项分开，避免把任务配置误认为当前节点配置。
let nodeOptionPick = null;
function attachTargetPicker(input,node,accept){
  if(input.parentElement.classList.contains('xpath-picker')){
    const button=input.parentElement.querySelector('button');button.disabled=scraping;button.onclick=async()=>{nodeOptionPick={id:node.id,accept};await setPicking(true);toast('请点击网页中的目标元素');};return;
  }
  const wrap=document.createElement('span');wrap.className='xpath-picker';input.replaceWith(wrap);wrap.append(input);
  input.placeholder='未设置 XPath';
  const button=document.createElement('button');button.type='button';button.className='mini node-pick';button.title='从网页选择元素';button.setAttribute('aria-label','从网页选择元素');button.disabled=scraping;
  button.innerHTML='<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M9 3H3v6m12-6h6v6M3 15v6h6M21 15v6h-6M9 9l4 11 2-5 5-2Z"/></svg>';
  button.onclick=async()=>{nodeOptionPick={id:node.id,accept};await setPicking(true);toast('请点击网页中的目标元素');};wrap.append(button);
}
function setupNodeOptions() {
  const basic = $('tab-basic'), advanced = $('tab-adv');
  const taskOptions = document.createElement('details');
  taskOptions.id = 'taskOptions'; taskOptions.className = 'task-options';
  const summary = document.createElement('summary'); summary.textContent = '任务采集选项（整个任务共用）';
  taskOptions.append(summary, ...advanced.children);
  advanced.after(taskOptions);
  basic.prepend($('nodeSettings'));
  document.querySelector('[data-settings=pages]').replaceChildren();
}
function renderNodeOptions(node) {
  nodeOptionPick = null;
  const advanced = $('tab-adv'),taskOptions=$('taskOptions');
  taskOptions.remove();advanced.replaceChildren();
  taskOptions.hidden=!['list','pages','extract','scrollLoop','loadMore'].includes(node.type);
  advanced.append(taskOptions);
  const retry=$('tab-retry');retry.replaceChildren();
  const host = document.querySelector('[data-settings=pages]'); host.replaceChildren();
  const p = node.params, before = {...p.before};
  const options={},after={...p.after};
  const eligible=NodeRetry.atomicTypes.includes(node.type);
  // Legacy retries remain immediate until the user applies a structured policy.
  const policy=structuredClone(p.retry||{enabled:Number(p.retries)>0,count:Number(p.retries)||3,intervalSec:p.retries?0:5,conditions:[],rotateUserAgent:false,userAgents:[],rotateProxy:false,proxies:[]});
  policy.conditions||=[];policy.userAgents||=[];policy.proxies||=[];
  const ownsDraft=()=>selectedNode===node.id&&currentNode()===node&&captureNodeDraft===capture;
  const page = {...p, mode:p.mode||(p.selector?Workflow.selectorMode(p):'xpath'), selector:p.selector || ''};
  const isPages = node.type === 'pages';
  let pickedCondition=null;
  const selector=$('nodeExtra').querySelector('[data-param=selector]');
  const mode=$('nodeExtra').querySelector('[data-param=mode]');
  if(mode)mode.parentElement.hidden=true;
  if(selector){
    selector.parentElement.firstChild.textContent='元素 XPath';
    attachTargetPicker(selector,node,data=>{pickedCondition={selector:data.xpath,mode:'xpath',relative:false};selector.value=data.xpath;if(mode)mode.value='xpath';});
    selector.addEventListener('change',()=>{pickedCondition=null;p.mode='xpath';});
    const operator=$('nodeExtra').querySelector('[data-param=operator]');
    if(operator){const update=()=>{selector.closest('label').hidden=operator.value.startsWith('url');};operator.addEventListener('change',update);update();}
  }
  if(node.type==='next'){
    $('nextMode').closest('label').hidden=false;
    attachTargetPicker($('nextSelector'),node,data=>{$('nextSelector').value=data.xpath;$('nextMode').value='xpath';updateSelectorLabels();});
    $('nextSelector').onchange=updateSelectorLabels;
  }
  if(node.type==='list'){
    $('listMode').closest('label').hidden=false;
    attachTargetPicker($('listSelector'),node,data=>{$('listSelector').value=data.xpath;$('listMode').value='xpath';$('listCheckStatus').hidden=true;updateSelectorLabels();});
    $('listSelector').onchange=()=>{$('listCheckStatus').hidden=true;};
  }
  $('fieldsCard').hidden=node.type!=='extract';updateSelectorLabels();
  function control(parent, text, type, value, change) {
    const row=document.createElement('label');row.className='node-option-row'+(type==='checkbox'?' check-row':'');
    const caption=document.createElement('span');caption.textContent=text.replace('（秒）','').replace('秒数','时间');
    const input=document.createElement(['select','textarea'].includes(type)?type:'input');
    if(!['select','textarea'].includes(type))input.type=type;
    if(type==='checkbox')input.checked=!!value;else input.value=value??'';
    input.disabled=scraping;input.onchange=()=>{if(!scraping)change(type==='checkbox'?input.checked:input.value);};
    if(['text','textarea','number'].includes(type))input.oninput=input.onchange;
    if(type==='checkbox')row.append(input,caption);else row.append(caption,input);parent.append(row);if(type==='number'&&(text.includes('秒')))addInputUnit(input,'s');return input;
  }
  function select(parent,text,choices,value,change) {
    const el=control(parent,text,'select','',change);
    choices.forEach(([label,key])=>el.add(new Option(label,key)));el.value=value;return el;
  }
  function target(parent, model, key, text) {
    const input=control(parent,text,'text',model[key],value=>{model[key]=value.trim();});
    input.placeholder='未设置 XPath';
    attachTargetPicker(input,node,data=>{model[key]=data.xpath;input.value=data.xpath;if(key==='selector'){model.mode='xpath';parent.querySelector('select').value='xpath';}});return input;
  }
  function param(parent,key,text,type,value,change){
    const input=control(parent,text,type,p[key]??value,v=>{options[key]=type==='number'?Number(v):v;change?.(v);});input.dataset.param=key;return input;
  }
  function hint(parent,text){const el=document.createElement('p');el.className='setting-hint';el.textContent=text;parent.append(el);return el;}
  if(node.type==='open'){
    const open=$('openOptions');open.replaceChildren();
    const loopField=document.createElement('div');
    param(open,'useLoopUrl','使用当前循环项网址','checkbox',false,v=>{loopField.hidden=!v;loopHelp.hidden=!v;$('btnNodeOpen').disabled=scraping||v;});
    param(loopField,'loopUrlField','网址字段名','text','');open.append(loopField);loopField.hidden=!p.useLoopUrl;
    const loopHelp=hint(open,'循环执行时才解析当前项链接；字段名留空时使用当前项或其子链接。');loopHelp.hidden=!p.useLoopUrl;
    param(open,'jsonRequest','以 JSON GET 打开','checkbox',false,v=>jsonHelp.hidden=!v);
    const jsonHelp=hint(open,'解析最多 2 MiB 的 JSON 响应，供普通 DOM 提取；不提供 JSONPath 映射。');jsonHelp.hidden=!p.jsonRequest;
    param(open,'continueOnTimeout','页面加载超时后继续','checkbox',false);
    $('btnNodeOpen').disabled=scraping||!!p.useLoopUrl;
    $('btnNodeOpen').title=p.useLoopUrl?'循环网址仅在循环执行时解析':'预览当前填写的网址';
  }
  if(eligible){
    const enabled=control(retry,'启用重试','checkbox',policy.enabled,v=>{policy.enabled=v;retryBody.hidden=!v;});enabled.dataset.retry='enabled';
    hint(retry,'步骤失败或满足任一条件时重试；未添加条件时只处理执行错误。');
    const retryBody=document.createElement('div');retryBody.hidden=!policy.enabled;retry.append(retryBody);
    function presets(text,key,values,defaultValue){const value=policy[key]??defaultValue;const choices=[...values];if(!choices.includes(Number(value)))choices.push(Number(value));const input=select(retryBody,text,choices.map(n=>[String(n)+(key==='intervalSec'?' 秒':''),String(n)]),String(value),v=>policy[key]=Number(v));input.dataset.retry=key;return input;}
    const count=presets('重试次数','count',[3,5,10,20,30],3);count.dataset.param='retries';
    presets('重试间隔（秒）','intervalSec',[0,1,3,5,10,30],5);
    hint(retryBody,'重试次数为首次执行失败后的额外尝试次数。');
    const cards=document.createElement('div');cards.className='retry-conditions';retryBody.append(cards);
    function drawConditions(){
      cards.replaceChildren();
      policy.conditions.forEach((condition,index)=>{
        const card=document.createElement('section');card.className='retry-condition';card.dataset.condition=index;
        const header=document.createElement('div');header.className='retry-condition-heading';const title=document.createElement('span');title.textContent='条件 '+(index+1);
        const remove=document.createElement('button');remove.type='button';remove.className='mini';remove.textContent='删除';remove.dataset.removeRetryCondition=index;remove.disabled=scraping;remove.onclick=()=>{if(scraping)return;policy.conditions.splice(index,1);markSettingsDirty();drawConditions();};header.append(title,remove);card.append(header);
        function field(key,text,type,value,change){const input=control(card,text,type,value,v=>{condition[key]=v;change?.();});input.dataset.conditionKey=key;return input;}
        const subject=field('subject','判断对象','select','',()=>{if(condition.subject!=='xpath'){condition.inFrame=false;if(['exists','missing'].includes(condition.operator))condition.operator='contains';}drawConditions();});
        [['当前网址','url'],['网页文本','text'],['XPath 元素','xpath']].forEach(([label,value])=>subject.add(new Option(label,value)));subject.value=condition.subject;
        const operator=field('operator','判断方式','select','',drawConditions);
        const choices=[['包含','contains'],['不包含','notContains']];if(condition.subject==='xpath')choices.push(['存在','exists'],['不存在','missing']);choices.forEach(([label,value])=>operator.add(new Option(label,value)));operator.value=condition.operator;
        if(condition.subject==='xpath'){
          field('xpath','元素 XPath','text',condition.xpath||'');
          field('inFrame','元素在 iframe 里','checkbox',condition.inFrame,drawConditions);
          if(condition.inFrame)field('frameXPath','iframe XPath','text',condition.frameXPath||'');
        }
        if(['contains','notContains'].includes(condition.operator))field('value','比较值','text',condition.value||'');
        cards.append(card);
      });
    }
    drawConditions();
    const add=document.createElement('button');add.type='button';add.className='mini';add.dataset.addRetryCondition='';add.textContent='＋ 添加条件';add.disabled=scraping;add.onclick=()=>{if(scraping)return;policy.conditions.push({subject:'url',operator:'contains',value:'',xpath:'',inFrame:false,frameXPath:''});markSettingsDirty();drawConditions();};retryBody.append(add);
    function pool(key,label,dialogId,summaryId,open){
      const check=control(retryBody,label,'checkbox',policy[key],v=>policy[key]=v);check.dataset.retry=key;
      const row=document.createElement('div');row.className='retry-pool';const summary=document.createElement('span');summary.id=summaryId;summary.setAttribute('aria-live','polite');
      const button=document.createElement('button');button.type='button';button.className='mini';button.dataset.openDialog=dialogId;button.textContent='配置';button.disabled=scraping;button.onclick=open;row.append(summary,button);retryBody.append(row);return summary;
    }
    const lines=text=>[...new Set(text.split(/\r?\n/).map(line=>line.trim()).filter(Boolean))];
    const uaSummary=pool('rotateUserAgent','重试时轮换 User-Agent','userAgentDialog','nodeUaSummary',async()=>{
      if(scraping)return;
      const response=await cmd('browser-identities');if(!ownsDraft()||scraping)return;
      const presets=response.ok?response.userAgents||[]:[];const choices=$('uaPresets');choices.replaceChildren();
      for(const preset of presets){const row=document.createElement('label');row.className='check-row';const check=document.createElement('input');check.type='checkbox';check.value=preset.value;check.checked=policy.userAgents.includes(preset.value);row.append(check,document.createTextNode(preset.name));choices.append(row);}
      $('uaCustom').value=policy.userAgents.filter(value=>!presets.some(preset=>preset.value===value)).join('\n');$('uaError').textContent='';
      const selected=()=>[...new Set([...choices.querySelectorAll('input:checked')].map(input=>input.value).concat(lines($('uaCustom').value)))];
      const summary=()=>{$('uaError').textContent='';$('uaSummary').textContent='已选择 '+selected().length+' 个 User-Agent';};choices.onchange=summary;$('uaCustom').oninput=summary;summary();
      $('uaApply').disabled=scraping;$('uaApply').onclick=()=>{if(!ownsDraft()||scraping)return;const values=selected();if(!values.length){$('uaError').textContent='请至少选择或填写一个 User-Agent';return;}policy.userAgents=values;updatePools();markSettingsDirty();$('userAgentDialog').close();};
      await openPanelDialog('userAgentDialog');if(!ownsDraft())$('userAgentDialog').close();
    });
    const proxySummary=pool('rotateProxy','重试时轮换代理','proxyPoolDialog','nodeProxySummary',async()=>{
      if(scraping)return;$('proxyPoolInput').value=policy.proxies.join('\n');$('proxyError').textContent='';
      const summary=()=>{$('proxyError').textContent='';$('proxySummary').textContent='已填写 '+lines($('proxyPoolInput').value).length+' 个代理';};$('proxyPoolInput').oninput=summary;summary();
      $('proxyApply').disabled=scraping;$('proxyApply').onclick=()=>{if(!ownsDraft()||scraping)return;const values=lines($('proxyPoolInput').value);try{if(!values.length)throw Error('请填写至少一个实际可用的代理网址');values.forEach(NodeRetry.proxyRules);}catch(error){$('proxyError').textContent=error.message;return;}policy.proxies=values;updatePools();markSettingsDirty();$('proxyPoolDialog').close();};
      await openPanelDialog('proxyPoolDialog');if(!ownsDraft())$('proxyPoolDialog').close();
    });
    function updatePools(){uaSummary.textContent='已配置 '+policy.userAgents.length+' 个标识';proxySummary.textContent='已配置 '+policy.proxies.length+' 个代理';}updatePools();
    hint(retryBody,'User-Agent 仅更换 Chromium 标识；代理需自行提供，实际可用性以执行结果为准。');
    const onError=$('nodeExtra').querySelector('[data-param=onError]');if(onError)retry.append(onError.closest('label'));
  }else hint(retry,'此步骤不支持条件重试；循环与提取步骤不会通过重放来重试。');
  if(isPages){
    select(host,'定位方式',[['XPath','xpath'],['CSS','css']],page.mode,v=>{page.mode=v;});
    target(host,page,'selector','翻页元素定位');
    const frame=document.createElement('div');
    control(host,'元素在 iframe 里','checkbox',page.inFrame,v=>{page.inFrame=v;frame.hidden=!v;});
    target(frame,page,'frameXPath','iframe XPath');host.append(frame);frame.hidden=!page.inFrame;
    const meta=document.createElement('p');meta.textContent='标签：暂无　文本：暂无';
    const inspect=document.createElement('button');inspect.className='mini';inspect.textContent='检查定位';inspect.disabled=scraping;
    inspect.onclick=async()=>{if(!page.selector){toast('请先设置翻页元素定位');return;}const result=await cmd('node-target-xpath',page);if(result.ok){meta.textContent=result.data.exists?'标签：'+result.data.tag+'　文本：'+(result.data.text||'无'):'当前页面未匹配元素';}};
    host.append(meta,inspect);
    const hint=document.createElement('p');hint.textContent='留空沿用已有翻页定位。任务最大页数始终生效；节点次数可进一步限制。关闭自动翻页时只采当前页。';host.append(hint);
    const countWrap=document.createElement('div');
    const limited=p.limitEnabled??(p.count!==undefined);
    page.limitEnabled=limited;
    control(host,'按次数退出循环','checkbox',limited,v=>{page.limitEnabled=v;countWrap.hidden=!v;});
    const count=control(countWrap,'循环执行次数','number',p.count??5,v=>page.count=Number(v));count.min=1;count.max=999;page.count=p.count??5;
    host.append(countWrap);countWrap.hidden=!limited;
  }
  const title=document.createElement('h3');title.textContent='步骤执行前';advanced.append(title);
  const waitBox=document.createElement('div');
  const beforeEnabled=control(advanced,'执行前等待','checkbox',before.enabled,v=>{before.enabled=v;waitBox.hidden=!v;});beforeEnabled.dataset.param='before.enabled';
  const beforeMode=select(waitBox,'等待方式',[['固定等待','fixed'],['随机等待 3～15 秒','random']],before.mode||'fixed',v=>{before.mode=v;fixed.closest('label').hidden=v!=='fixed';});beforeMode.dataset.param='before.mode';
  const fixed=control(waitBox,'等待秒数','number',before.seconds??0,v=>before.seconds=Number(v));fixed.dataset.param='before.seconds';fixed.min=0;fixed.step='any';fixed.closest('label').hidden=before.mode==='random';
  const targetBox=document.createElement('div');
  control(waitBox,'等待指定元素出现','checkbox',before.waitElement,v=>{before.waitElement=v;targetBox.hidden=!v;});
  target(targetBox,before,'xpath','元素 XPath');
  const frameBox=document.createElement('div');
  control(targetBox,'元素在 iframe 里','checkbox',before.inFrame,v=>{before.inFrame=v;frameBox.hidden=!v;});
  target(frameBox,before,'frameXPath','iframe XPath');targetBox.append(frameBox);frameBox.hidden=!before.inFrame;
  const timeout=control(targetBox,'等待超时（秒）','number',before.timeout??25,v=>before.timeout=Number(v));timeout.min=0;timeout.step='any';
  waitBox.append(targetBox);targetBox.hidden=!before.waitElement;advanced.append(waitBox);waitBox.hidden=!before.enabled;
  if(node.type==='open'){
    const navigationTitle=document.createElement('h3');navigationTitle.textContent='网页打开前';advanced.append(navigationTitle);
    param(advanced,'clearCache','清除网页缓存','checkbox',false);
    hint(advanced,'仅清理 HTTP 缓存，保留登录 Cookie 和网页存储。');
    const cookieBox=document.createElement('div');
    param(advanced,'cookieEnabled','导入自定义 Cookie','checkbox',false,v=>cookieBox.hidden=!v);
    const cookie=param(cookieBox,'cookieText','Cookie 内容','textarea','');cookie.rows=3;cookie.spellcheck=false;
    hint(cookieBox,'支持 Cookie 请求头或 JSON Cookie 数组，仅导入目标主机，路径为 /。');advanced.append(cookieBox);cookieBox.hidden=!p.cookieEnabled;
    param(advanced,'blockPopups','阻止网页弹窗跳转','checkbox',false);
    hint(advanced,'随后打开网页，再执行下方滚动、等待，最后判断重试条件。');
  }
  if(['open','input','inputGroup'].includes(node.type)){
    const afterTitle=document.createElement('h3');afterTitle.textContent='步骤执行后';advanced.append(afterTitle);
    if(node.type==='open'){
      const scrollBox=document.createElement('div');
      param(advanced,'scrollAfter','打开后滚动网页','checkbox',false,v=>scrollBox.hidden=!v);
      const maximum=param(scrollBox,'scrollMaxSec','滚动上限（秒）','number',10);maximum.min=0;maximum.max=3600;maximum.step='any';advanced.append(scrollBox);scrollBox.hidden=!p.scrollAfter;
    }
    const afterBox=document.createElement('div');
    const enabled=control(advanced,'执行后等待','checkbox',after.enabled,v=>{after.enabled=v;afterBox.hidden=!v;});enabled.dataset.param='after.enabled';
    const seconds=control(afterBox,'等待秒数','number',after.seconds??1,v=>after.seconds=Number(v));seconds.dataset.param='after.seconds';seconds.min=0;seconds.step='any';afterBox.hidden=!after.enabled;advanced.append(afterBox);
    const enter=$('nodeExtra').querySelector('[data-param=enter]');if(enter)advanced.append(enter.closest('label'));
  }
  function newOptions(){return {...options,...(['open','input','inputGroup'].includes(node.type)?{after:{...after}}:{}),...(eligible?{retry:structuredClone(policy),retries:policy.enabled?Number(policy.count??3):0}:{})};}
  function capture(){
    if(Workflow.find(cfg.flow||[],node.id)?.node!==node)return;
    Object.assign(p,newOptions(),{before:{...before}});
    if(pickedCondition)Object.assign(p,pickedCondition);
    if(isPages){Object.assign(p,{selector:page.selector,mode:page.mode,inFrame:!!page.inFrame,frameXPath:page.frameXPath||'',limitEnabled:page.limitEnabled,count:page.count});if(!page.limitEnabled)delete p.count;}
    if(node.type==='list'){
      p.list={...p.list,type:$('listMode').value,selector:$('listSelector').value.trim()};
      if(p.list.genericGrid)p.list.scanHidden=$('listVirtualGrid').checked;else p.list.virtualGrid=$('listVirtualGrid').checked;
      cfg.list=p.list;
    }
    if(node.type==='next')setNextRule(node,$('nextSelector').value.trim(),$('nextMode').value);
  }
  captureNodeDraft=capture;
  async function apply(){
    if(scraping)return;
    const inputs=[...host.querySelectorAll('input'),...advanced.querySelectorAll('input')];
    const invalid=inputs.find(el=>el.getClientRects().length&&!el.checkValidity());if(invalid){showConfigError(invalid);return;}
    if(['input','inputGroup'].includes(node.type)&&(p.entries||[p]).some(entry=>!entry.relative&&!entry.selector?.trim())){toast('请为每个文本框选择网页元素');return;}
    if(before.enabled&&before.waitElement&&(!before.xpath?.trim()||(before.inFrame&&!before.frameXPath?.trim()))){toast('请填写等待元素及 iframe 的 XPath');return;}
    if(isPages&&page.inFrame&&(!page.frameXPath?.trim()||!page.selector?.trim())){toast('请填写翻页元素及 iframe 定位');return;}
    if(isPages&&!validateNodeSelector(page.mode,page.selector,'翻页定位'))return;
    const updated={...p,...newOptions(),before:{...before}};
    if(pickedCondition)Object.assign(updated,pickedCondition);
    if(isPages){Object.assign(updated,{selector:page.selector,mode:page.mode,inFrame:!!page.inFrame,frameXPath:page.frameXPath||'',limitEnabled:page.limitEnabled});if(page.limitEnabled)updated.count=page.count;else delete updated.count;}
    try{Workflow.validate([{...node,params:updated}]);}catch(error){toast(error.message);return;}
    rememberFlow();Object.assign(p,updated);if(isPages&&!page.limitEnabled)delete p.count;return true;
  }
  applyCurrentNode=apply;
}
async function acceptNodeOptionPick(payload){
  const pending=nodeOptionPick;nodeOptionPick=null;
  if(!pending||pending.id!==selectedNode)return;
  const result=await cmd('node-target-xpath',{path:payload.path});
  if(result.ok&&result.data?.table&&currentNode()?.type==='list'){
    await selectWholeTable(payload.path,pending.id);return;
  }
  if(result.ok&&result.data?.exists){pending.accept({...result.data,xpath:payload.xpath||result.data.xpath});markSettingsDirty();await setPicking(false);toast('已填入元素 XPath，点击应用保存节点设置');}
  else toast('未找到所选元素，请重新选择');
}



