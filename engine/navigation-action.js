'use strict';
const pagecode=require('./pagecode');
const MAX_JSON_BYTES=2*1024*1024;

// A timeout must cancel Chromium's pending navigation, including loadURL itself.
async function navigate(scraper,url,seconds) {
  const wc=scraper.view.webContents;
  if(!/^https?:\/\//i.test(url))throw Error('打开网页节点需要 http 或 https 网址');
  let timer;
  try{
    delete wc.__v6JsonUrl;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Object.assign(Error('页面加载超时'),{code:'V6_NAV_TIMEOUT'}));wc.stop();},Math.max(1,Number(seconds??scraper.opts.loadTimeoutSec??25)*1000));});
    await scraper.interruptible(Promise.race([wc.loadURL(url),timeout]));
  }finally{clearTimeout(timer);}
}

async function captureLoopUrls(scraper,nodes,cfg,list,count,sourceUrl) {
  const descriptors=[];
  const walk=children=>{for(const node of children||[]){
    if(node.enabled===false||['list','detail'].includes(node.type))continue;
    const p=node.params||{};
    if(node.type==='open'&&p.useLoopUrl){
      const field=p.loopUrlField&&((scraper.cfg.fields||[]).find(f=>f.name===p.loopUrlField)||(p.fields||cfg.fields).find(f=>f.name===p.loopUrlField));
      descriptors.push({id:node.id,field:field||undefined,error:p.loopUrlField&&!field?'循环网址字段不存在：'+p.loopUrlField:undefined});
    }
    walk(node.children);
  }};
  walk(nodes);
  if(!descriptors.length||scraper.stopped)return [];
  const result=await scraper.exec(pagecode.loopUrlsCode(),list,descriptors,count,sourceUrl);
  if(!result.ok)throw Error('循环网址读取失败：'+result.error);
  return result.data;
}

async function resolveOpenUrl(scraper,p,cfg,context,nodeId) {
  if(!p.useLoopUrl)return p.url||scraper.cfg.url;
  if(context.retry?.id===nodeId&&context.retry.openUrl)return context.retry.openUrl;
  const target=context.loopOwner?.targets?.[nodeId];
  if(!target)throw Error('循环网址不可用：请将打开网页放在循环列表内，并配置链接或网址字段');
  if(target.error)throw Error(target.error);
  return target.url;
}

// Import only Cookie pairs; cookie JSON may not broaden the requested host/path.
async function applyCookies(scraper,url,text) {
  if(!String(text||'').trim())return;
  let cookies;
  try{
    cookies=String(text).trim().startsWith('[')?JSON.parse(text):String(text).split(';').filter(x=>x.trim()).map(pair=>{const i=pair.indexOf('=');if(i<1)throw Error();return {name:pair.slice(0,i).trim(),value:pair.slice(i+1).trim()};});
    if(!Array.isArray(cookies)||cookies.some(c=>!c||typeof c.name!=='string'||!c.name||typeof c.value!=='string'))throw Error();
  }catch{throw Error('Cookie 格式无效，请填写 Cookie 键值对或 JSON Cookie 数组');}
  const target=new URL(url);
  for(const c of cookies){
    const details={url:target.origin+'/',name:c.name,value:c.value,path:'/',secure:target.protocol==='https:',httpOnly:!!c.httpOnly};
    if(c.sameSite&&['unspecified','no_restriction','lax','strict'].includes(c.sameSite))details.sameSite=c.sameSite;
    if(Number.isFinite(c.expirationDate))details.expirationDate=c.expirationDate;
    try{await scraper.interruptible(scraper.view.webContents.session.cookies.set(details));}catch(error){if(scraper.stopped)throw error;throw Error('Cookie 设置失败，请检查 Cookie 名称及当前网址');}
  }
}

async function jsonGet(scraper,url,seconds) {
  const wc=scraper.view.webContents,controller=new AbortController();let timer;
  delete wc.__v6JsonUrl;
  const cancel=()=>controller.abort();scraper.stopListeners.add(cancel);
  timer=setTimeout(cancel,Math.max(1,Number(seconds??scraper.opts.loadTimeoutSec??25)*1000));
  try{
    const response=await scraper.interruptible(wc.session.fetch(url,{method:'GET',credentials:'include',headers:{'User-Agent':wc.getUserAgent()},signal:controller.signal}));
    if(!response.ok)throw Error('JSON 请求失败：HTTP '+response.status);
    if(Number(response.headers.get('content-length'))>MAX_JSON_BYTES)throw Error('JSON 响应超过 2 MiB 上限');
    const reader=response.body.getReader(),chunks=[];let bytes=0;
    while(true){const {done,value}=await scraper.interruptible(reader.read());if(done)break;bytes+=value.byteLength;if(bytes>MAX_JSON_BYTES){controller.abort();throw Error('JSON 响应超过 2 MiB 上限');}chunks.push(Buffer.from(value));}
    let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Error('响应不是有效 JSON');}
    const escaped=JSON.stringify(data,null,2).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const html='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>JSON 响应</title><style>body{margin:20px;font:14px monospace}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>'+escaped+'</pre>';
    await scraper.interruptible(wc.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html)),Math.max(1000,Number(seconds??25)*1000));
    wc.__v6JsonUrl=url;
  }catch(error){if(controller.signal.aborted&&!scraper.stopped&&error.message!=='JSON 响应超过 2 MiB 上限')throw Object.assign(Error('JSON 请求超时'),{code:'V6_NAV_TIMEOUT'});throw error;}
  finally{clearTimeout(timer);scraper.stopListeners.delete(cancel);controller.abort();}
}

async function open(scraper,p,url) {
  const wc=scraper.view.webContents;
  if(!/^https?:\/\//i.test(url))throw Error('打开网页节点需要 http 或 https 网址');
  wc.__v6BlockPopups=!!p.blockPopups;
  if(p.clearCache)await scraper.interruptible(wc.session.clearCache());
  if(p.cookieEnabled)await applyCookies(scraper,url,p.cookieText);
  try{if(p.jsonRequest)await jsonGet(scraper,url,p.timeout);else await navigate(scraper,url,p.timeout);}
  catch(error){if(error.code==='V6_NAV_TIMEOUT'&&p.continueOnTimeout&&!scraper.stopped)scraper.onLog('页面加载超时，按节点设置继续执行');else throw error;}
  if(p.scrollAfter&&!scraper.stopped){
    const deadline=scraper.now()+Number(p.scrollMaxSec??10)*1000;
    while(!scraper.stopped&&scraper.now()<deadline){
      const result=await scraper.interruptible(scraper.exec('()=>{const el=document.scrollingElement;if(!el)return true;const before=el.scrollTop;el.scrollBy(0,Math.max(100,innerHeight*.8));return el.scrollTop===before&&el.scrollTop+el.clientHeight>=el.scrollHeight-1;}'),Math.max(1,deadline-scraper.now()));
      if(!result.ok)throw Error(result.error);
      if(result.data)break;
      await scraper.wait(Math.min(100,Math.max(0,deadline-scraper.now())));
    }
  }
}
module.exports={navigate,captureLoopUrls,resolveOpenUrl,open};
