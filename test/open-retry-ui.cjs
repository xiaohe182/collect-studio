const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),Module=require('node:module');
app.disableHardwareAcceleration();
const root=fs.mkdtempSync(path.join(os.tmpdir(),'v6-open-retry-ui-'));app.setPath('userData',path.join(root,'profile'));
const storage=require('../engine/storage'),isolated=new Module(path.join(root,'engine/storage.js'));isolated.filename=path.join(root,'engine/storage.js');isolated._compile(fs.readFileSync(path.join(__dirname,'../engine/storage.js'),'utf8'),isolated.filename);Object.assign(storage,isolated.exports);require('../main');
app.whenReady().then(async()=>{try{
  const win=BrowserWindow.getAllWindows()[0];if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));const run=async s=>{let timer;try{return await Promise.race([win.webContents.executeJavaScript(s),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Renderer script timed out')),8000))]);}catch(error){console.error('Renderer script:',s);throw error;}finally{clearTimeout(timer);}};
  await run(`settingsDirty=false;cfg={id:'open-retry-ui',name:'离线配置测试',url:'https://example.com',fields:[],flow:[{id:'a',type:'open',name:'打开 A',params:{url:'https://example.com/a',retries:7}},{id:'b',type:'open',name:'打开 B',params:{url:'https://example.com/b'}},{id:'loop',type:'list',name:'循环',params:{},children:[]}]};selectNode('a');`);
  assert.equal(await run(`$('nodeUrl').tagName`),'TEXTAREA');
  for(const key of ['useLoopUrl','loopUrlField','jsonRequest','continueOnTimeout'])assert.equal(await run(`!!$('tab-basic').querySelector('[data-param=${key}]')`),true,key);
  for(const key of ['clearCache','cookieEnabled','cookieText','blockPopups','scrollAfter','scrollMaxSec'])assert.equal(await run(`!!$('tab-adv').querySelector('[data-param=${key}]')`),true,key);
  assert.equal(await run(`$('nodeExtra').querySelector('[data-param=timeout]')!==null`),true);
  assert.equal(await run(`$('settingsPanel').contains($('log'))`),false);
  assert.equal(await run(`$('taskOptions').textContent.includes('运行日志')`),false);
  assert.equal(await run(`document.querySelectorAll('#log').length`),1);
  const change=async(selector,value)=>run(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw Error('missing '+${JSON.stringify(selector)});${typeof value==='boolean'?`input.checked=${value}`:`input.value=${JSON.stringify(String(value))}`};input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const param=(key,value)=>change(`[data-param="${key}"]`,value),retry=(key,value)=>change(`[data-retry="${key}"]`,value),condition=(key,value)=>change(`[data-condition="0"] [data-condition-key="${key}"]`,value);
  await param('useLoopUrl',true);assert.equal(await run(`$('btnNodeOpen').disabled`),true);await param('loopUrlField','详情链接');await param('jsonRequest',true);await param('continueOnTimeout',true);
  await param('cookieEnabled',true);await param('cookieText','fixture=local');await param('clearCache',true);await param('blockPopups',true);await param('scrollAfter',true);await param('scrollMaxSec',2.5);await param('after.enabled',true);await param('after.seconds',0.25);
  await param('before.enabled',true);await param('before.seconds',0.75);
  assert.equal(await run(`$('nodeUrl').value`),'https://example.com/a');await param('useLoopUrl',false);assert.equal(await run(`$('nodeUrl').value`),'https://example.com/a');await param('useLoopUrl',true);
  await run(`document.querySelector('[data-tab=retry]').click()`);
  assert.deepEqual(await run(`[...document.querySelector('[data-retry=count]').options].map(o=>o.value)`),['3','5','10','20','30','7']);
  assert.equal(await run(`document.querySelector('[data-retry=intervalSec]').value`),'0','legacy retry keeps immediate interval');
  await retry('count',5);await retry('intervalSec',3);await run(`document.querySelector('[data-add-retry-condition]').click()`);await condition('subject','xpath');await condition('xpath','//article');await condition('inFrame',true);
  assert.equal(await run(`document.querySelector('[data-condition-key=frameXPath]')!==null`),true);
  assert.equal(await run(`applyCurrentNode()`),undefined,'missing iframe XPath must fail local Apply');assert.equal(await run(`!!cfg.flow[0].params.retry`),false,'invalid policy must not commit');
  await condition('frameXPath','//iframe');await condition('operator','exists');assert.equal(await run(`document.querySelector('[data-condition-key=value]')===null`),true);await condition('operator','contains');await condition('value','验证');
  await run(`document.querySelector('[data-add-retry-condition]').click();document.querySelector('[data-remove-retry-condition="1"]').click()`);assert.equal(await run(`document.querySelectorAll('[data-condition]').length`),1);assert.equal(await run(`document.querySelector('[data-condition-key=value]').value`),'验证');
  await retry('rotateUserAgent',true);assert.equal(await run(`applyCurrentNode()`),undefined,'empty enabled UA pool must fail locally');
  await run(`document.querySelector('[data-open-dialog=userAgentDialog]').onclick()`);assert.equal(await run(`$('userAgentDialog').open`),true);
  assert.equal(await run(`$('uaPresets').querySelectorAll('input').length>=2`),true);
  await run(`$('uaCustom').value='Fixture-UA-Cancel';$('userAgentDialog').close()`);
  await run(`document.querySelector('[data-open-dialog=userAgentDialog]').onclick()`);assert.equal(await run(`$('uaCustom').value`),'','cancel is local');
  await run(`const first=$('uaPresets').querySelector('input');first.checked=true;first.dispatchEvent(new Event('change',{bubbles:true}));$('uaCustom').value='Fixture-UA/1.0';$('uaCustom').dispatchEvent(new Event('input',{bubbles:true}));`);
  assert.match(await run(`$('uaSummary').textContent`),/2/);
  const shots=path.join(__dirname,'../output/open-retry-20261021/ui-shots');fs.mkdirSync(shots,{recursive:true});
  await run(`$('notice').hidden=true`);win.showInactive();win.setSize(1560,920);await new Promise(r=>setTimeout(r,150));fs.writeFileSync(path.join(shots,'user-agent-1560.png'),(await win.webContents.capturePage()).toPNG());
  await run(`$('uaApply').click()`);assert.equal(await run(`$('userAgentDialog').open`),false);
  await retry('rotateProxy',true);assert.equal(await run(`applyCurrentNode()`),undefined,'empty enabled proxy pool must fail locally');
  await run(`document.querySelector('[data-open-dialog=proxyPoolDialog]').onclick()`);await run(`$('proxyPoolInput').value='http://fixture:secret@127.0.0.1:8800';$('proxyApply').click()`);
  assert.equal(await run(`$('proxyPoolDialog').open`),true);assert.match(await run(`$('proxyError').textContent`),/认证/);
  for(const value of ['ftp://127.0.0.1:8800','http://127.0.0.1:8800/path','http://127.0.0.1:8800?q=1']){await run(`$('proxyPoolInput').value=${JSON.stringify(value)};$('proxyApply').click()`);assert.equal(await run(`$('proxyPoolDialog').open`),true);}
  await run(`$('proxyPoolInput').value=${JSON.stringify('http://127.0.0.1:8800\nsocks5://127.0.0.1:8801')};$('proxyPoolInput').dispatchEvent(new Event('input',{bubbles:true}));`);
  await run(`$('notice').hidden=true`);win.setSize(1100,640);await new Promise(r=>setTimeout(r,150));fs.writeFileSync(path.join(shots,'proxy-pool-1100.png'),(await win.webContents.capturePage()).toPNG());
  await run(`$('proxyApply').click()`);assert.equal(await run(`$('proxyPoolDialog').open`),false);
  await run(`document.querySelector('[data-tab=adv]').click();document.querySelector('[data-tab=basic]').click();selectNode('b');selectNode('a')`);
  assert.equal(await run(`$('nodeUrl').value`),'https://example.com/a');assert.equal(await run(`document.querySelector('[data-param=cookieText]').value`),'fixture=local');assert.equal(await run(`document.querySelector('[data-param=scrollMaxSec]').value`),'2.5');
  assert.equal(await run(`document.querySelector('[data-param="before.seconds"]').value`),'0.75');assert.equal(await run(`document.querySelector('[data-param="after.seconds"]').value`),'0.25');
  assert.equal(await run(`document.querySelector('[data-condition-key=frameXPath]').value`),'//iframe');
  assert.equal(await run(`document.querySelector('[data-retry=count]').value`),'5');assert.deepEqual(await run(`({enabled:cfg.flow[1].params.retry.enabled,conditions:cfg.flow[1].params.retry.conditions,proxies:cfg.flow[1].params.retry.proxies,userAgents:cfg.flow[1].params.retry.userAgents})`),{enabled:false,conditions:[],proxies:[],userAgents:[]},'source draft must not affect destination');
  await run(`$('btnApplySettings').onclick()`);assert.equal(await run(`settingsDirty`),false);assert.equal(await run(`saveCurrentTask(true)`),true);
  const saved=storage.getTask('open-retry-ui');assert.equal(saved.flow[0].params.retries,5);assert.equal(saved.flow[0].params.retry.count,5);assert.equal(saved.flow[0].params.retry.userAgents.length,2);assert.deepEqual(saved.flow[0].params.retry.proxies,['http://127.0.0.1:8800','socks5://127.0.0.1:8801']);
  await run(`settingsDirty=false;loadEditor(${JSON.stringify(saved)});selectNode('a')`);assert.equal(await run(`document.querySelector('[data-condition-key=value]').value`),'验证');
  await run(`document.querySelector('[data-open-dialog=proxyPoolDialog]').onclick();$('proxyPoolInput').value='http://127.0.0.1:9999';$('proxyPoolDialog').close()`);
  await run(`document.querySelector('[data-open-dialog=proxyPoolDialog]').onclick()`);assert.equal(await run(`$('proxyPoolInput').value`),'http://127.0.0.1:8800\nsocks5://127.0.0.1:8801');await run(`$('proxyPoolDialog').close()`);
  await condition('subject','text');await condition('value','');assert.equal(await run(`applyCurrentNode()`),undefined);await condition('value','有效');
  await run(`(async()=>{const realCmd=cmd;let finishIdentity;cmd=(name,data)=>name==='browser-identities'?new Promise(r=>finishIdentity=r):realCmd(name,data);try{const pendingIdentity=document.querySelector('[data-open-dialog=userAgentDialog]').onclick();selectNode('b');finishIdentity({ok:true,userAgents:[]});await pendingIdentity;}finally{cmd=realCmd;}})()`);
  assert.equal(await run(`$('userAgentDialog').open`),false,'late presets must not target another node');
  const untouched=await run(`structuredClone(cfg.flow[1].params.retry)`);await run(`selectNode('a');document.querySelector('[data-open-dialog=proxyPoolDialog]').onclick()`);await run(`selectNode('b');$('proxyApply').click()`);assert.deepEqual(await run(`cfg.flow[1].params.retry`),untouched,'stale modal confirmation cannot mutate another node');await run(`$('proxyPoolDialog').close()`);
  await run(`selectNode('a');setStartBtn(true)`);assert.equal(await run(`[...document.querySelectorAll('#settingsPanel input,#settingsPanel select,#settingsPanel textarea,#uaCustom,#proxyPoolInput,#uaApply,#proxyApply')].every(input=>input.disabled)`),true);await run(`setStartBtn(false)`);assert.equal(await run(`$('btnNodeOpen').disabled`),true,'dynamic URL remains non-previewable after a run');
  for(const [key,value] of [['count',0],['count',601],['count',1.5],['intervalSec',-1],['intervalSec',3601]]){
    await run(`captureNodeDraft();cfg.flow[0].params.retry.${key}=${value};settingsDirty=false;selectNode('a');`);assert.equal(await run(`applyCurrentNode()`),undefined,`${key} ${value}`);await run(`cfg.flow[0].params.retry.count=5;cfg.flow[0].params.retry.intervalSec=3;settingsDirty=false;selectNode('a')`);
  }
  for(const proxy of ['http://fixture:secret@127.0.0.1:8800','ftp://127.0.0.1:8800','http://127.0.0.1:8800/path']){
    await run(`captureNodeDraft();cfg.flow[0].params.retry.proxies=[${JSON.stringify(proxy)}];settingsDirty=false;selectNode('a')`);assert.equal(await run(`applyCurrentNode()`),undefined,'imported invalid proxy rejected by local Apply');
  }
  await run(`cfg.flow[0].params.retry.proxies=['http://127.0.0.1:8800'];settingsDirty=false;selectNode('a')`);
  for(const type of ['click','hover','input','inputGroup','select','back']){await run(`settingsDirty=false;cfg.flow.push({id:'test-'+${JSON.stringify(type)},type:${JSON.stringify(type)},name:'测试',params:{selector:'//input'}});selectNode('test-'+${JSON.stringify(type)})`);assert.equal(await run(`!!document.querySelector('[data-retry=enabled]')`),true,type);}
  await run(`selectNode('loop')`);assert.equal(await run(`document.querySelector('[data-retry=enabled]')===null`),true);
  const heights=await run(`({flow:$('flowTree').getBoundingClientRect().height,settings:$('settingsPanel').getBoundingClientRect().height})`);
  await run(`$('btnTaskLogs').onclick()`);assert.equal(await run(`$('resultsDialog').open&&resultTab==='logs'&&!scraping`),true);assert.deepEqual(await run(`({flow:$('flowTree').getBoundingClientRect().height,settings:$('settingsPanel').getBoundingClientRect().height})`),heights);await run(`$('resultsDialog').close()`);
  console.log('PASS real renderer opening/advanced placement, legacy/custom presets, XPath/iframe, UA and proxy local dialogs, atomic local Apply validation, draft isolation, Save/reopen, disabled edits and single result-log surface');app.exit(0);
}catch(error){console.error(error);app.exit(1);}});
