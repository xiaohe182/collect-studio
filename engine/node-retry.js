(function(root){
'use strict';
const atomicTypes=['open','click','hover','input','inputGroup','select','back'];

function proxyRules(value) {
  let url;try{url=new URL(value);}catch{throw Error('代理网址无效，请填写 HTTP、HTTPS 或 SOCKS 代理网址');}
  if(!['http:','https:','socks:','socks4:','socks5:'].includes(url.protocol)||!url.hostname||url.pathname!=='/'&&url.pathname!==''||url.search||url.hash)throw Error('代理格式不支持，请填写 HTTP、HTTPS 或 SOCKS 代理网址');
  if(url.username||url.password)throw Error('暂不支持带认证信息的代理，请使用无需认证的代理网址');
  return (url.protocol==='socks:'?'socks5:':url.protocol)+'//'+url.host;
}

function validatePolicy(p,type) {
  const r=p.retry;if(!r)return;
  if(typeof r!=='object'||Array.isArray(r))throw Error('重试设置无效');
  if(!r.enabled)return;
  if(!atomicTypes.includes(type))throw Error('条件重试仅支持打开、点击、移动、输入、下拉和返回节点');
  const count=Number(r.count??3),interval=Number(r.intervalSec??5);
  if(!Number.isInteger(count)||count<1||count>600||!Number.isFinite(interval)||interval<0||interval>3600)throw Error('重试次数或间隔超出范围');
  if(!Array.isArray(r.conditions??[]))throw Error('重试条件格式无效');
  for(const c of r.conditions||[]){
    if(!c||!['url','text','xpath'].includes(c.subject)||!['contains','notContains','exists','missing'].includes(c.operator))throw Error('重试条件类型无效');
    if(['contains','notContains'].includes(c.operator)&&!String(c.value||'').trim())throw Error('请填写重试条件比较值');
    if(c.subject==='xpath'&&!String(c.xpath||'').trim()||c.inFrame&&!String(c.frameXPath||'').trim())throw Error('请填写重试条件 XPath 和 iframe XPath');
  }
  if(r.rotateUserAgent&&(!Array.isArray(r.userAgents)||!r.userAgents.length||r.userAgents.some(x=>typeof x!=='string'||!x.trim()||/[\r\n]/.test(x))))throw Error('请配置有效 User-Agent 列表');
  if(r.rotateProxy){if(!Array.isArray(r.proxies)||!r.proxies.length)throw Error('请先配置代理池，无法在没有代理时切换 IP');r.proxies.forEach(proxyRules);}
}

function conditionState(condition) {
  let doc=document;
  if(condition.inFrame){
    const frame=doc.evaluate(condition.frameXPath,doc,null,9,null).singleNodeValue;
    if(!frame)throw Error('重试条件 iframe 不存在');
    doc=frame.contentDocument;if(!doc)throw Error('无法访问重试条件 iframe，请确认 iframe 与页面同源');
  }
  if(condition.subject==='text')return {exists:!!doc.body,text:doc.body?.innerText||''};
  const result=doc.evaluate(condition.xpath,doc,null,7,null),nodes=Array.from({length:result.snapshotLength},(_,i)=>result.snapshotItem(i));
  return {exists:!!nodes.length,text:nodes.map(n=>n.textContent||n.nodeValue||'').join('\n')};
}
async function matches(scraper,p) {
  if(!p.retry?.enabled)return false;
  for(const c of p.retry.conditions||[]){
    let state;
    if(c.subject==='url'){const wc=scraper.view.webContents,url=wc.getURL();state={exists:true,text:url.startsWith('data:')&&wc.__v6JsonUrl||url};}
    else{const result=await scraper.exec(conditionState.toString(),c);if(!result.ok)throw Object.assign(Error('重试条件定位失败：'+result.error),{fatal:true});state=result.data;}
    if(c.operator==='exists'?state.exists:c.operator==='missing'?!state.exists:c.operator==='contains'?state.text.includes(c.value):!state.text.includes(c.value))return true;
  }
  return false;
}

async function rotate(scraper,p,attempt) {
  const r=p.retry,wc=scraper.view.webContents;if(!r?.enabled)return;
  if(!scraper.browserPolicy)scraper.browserPolicy={ua:wc.getUserAgent(),sessionUA:wc.session.getUserAgent(),blockPopups:wc.__v6BlockPopups};
  if(r.rotateUserAgent){const current=r.userAgents.indexOf(wc.getUserAgent()),ua=r.userAgents[(current<0?attempt-1:current+1)%r.userAgents.length];wc.setUserAgent(ua);wc.session.setUserAgent(ua);}
  if(r.rotateProxy){
    scraper.proxyChanged=true;
    scraper.proxyTransition=(async()=>{
      await wc.session.setProxy({mode:'fixed_servers',proxyRules:proxyRules(r.proxies[(attempt-1)%r.proxies.length]),proxyBypassRules:'<-loopback>'});
      await wc.session.closeAllConnections();
    })();
    await scraper.interruptible(scraper.proxyTransition);
  }
}
async function restore(scraper) {
  if(scraper.browserCleanup)return scraper.browserCleanup;
  // A timed-out session is retired by main; never wait again or claim it restored.
  scraper.browserCleanup=(async()=>{
    const wc=scraper.view?.webContents,policy=scraper.browserPolicy;let timer;
    if(!wc||wc.isDestroyed?.())return;
    try{
      if(policy){wc.setUserAgent(policy.ua);wc.session.setUserAgent(policy.sessionUA);wc.__v6BlockPopups=policy.blockPopups;}
      if(scraper.proxyChanged){
        await Promise.race([
          (async()=>{await scraper.proxyTransition?.catch(()=>{});await wc.session.setProxy({mode:'system'});await wc.session.closeAllConnections();})(),
          new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('浏览器代理恢复超时，无法确认已恢复系统代理')),1000);})
        ]);
        scraper.proxyChanged=false;
      }
    }catch(error){scraper.browserCleanupFailed=true;throw error;}
    finally{clearTimeout(timer);}
  })();
  return scraper.browserCleanup;
}
const api={atomicTypes,validatePolicy,matches,rotate,restore,proxyRules};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NodeRetry=api;
})(typeof globalThis!=='undefined'?globalThis:this);
