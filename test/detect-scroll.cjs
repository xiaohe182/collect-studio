const {app,BrowserWindow}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const pagecode=require('../engine/pagecode');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-detect-')));
app.whenReady().then(async()=>{
  const win=new BrowserWindow({show:false,width:1100,height:700});
  const wc=win.webContents;
  try {
    const html=`<body><div id="items"></div><div id="inner" style="position:fixed;right:0;top:0;width:200px;height:160px;overflow:auto"></div>
    <script>
    let count=0,innerCount=0,pending=false,innerPending=false;
    function more(){for(let i=0;i<4;i++){count++;items.insertAdjacentHTML('beforeend','<article style="height:180px"><h3>商品 '+count+'</h3><p>用于全局滚动加载识别测试的商品内容</p><b>价格 '+count+'</b></article>')}}
    function innerMore(){for(let i=0;i<3;i++){innerCount++;inner.insertAdjacentHTML('beforeend','<p style="height:100px">内层 '+innerCount+'</p>')}}
    more();innerMore();
    window.addEventListener('scroll',()=>{if(!pending&&count<12&&scrollY+innerHeight>=document.documentElement.scrollHeight-10){pending=true;setTimeout(()=>{more();pending=false},180)}});
    inner.addEventListener('scroll',()=>{if(!innerPending&&innerCount<9&&inner.scrollTop+inner.clientHeight>=inner.scrollHeight-5){innerPending=true;setTimeout(()=>{innerMore();innerPending=false},180)}});
    </script></body>`;
    await win.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    const started=Date.now();
    const scan=await wc.executeJavaScript(`(${pagecode.prepareDetectCode()})({waitMs:250,maxMs:15000})`);
    assert.equal(scan.limited,false);assert.equal(scan.cancelled,false);
    assert.deepEqual(await wc.executeJavaScript(`({items:document.querySelectorAll('article').length,inner:document.querySelectorAll('#inner p').length,top:scrollY,innerTop:document.querySelector('#inner').scrollTop,marked:document.querySelectorAll('[data-v6hl]').length})`),{items:12,inner:9,top:0,innerTop:0,marked:0});
    await wc.executeJavaScript(`document.body.insertAdjacentHTML('beforeend','<button id=loadmore>加载更多</button><button disabled>显示更多</button>')`);
    const detected=await wc.executeJavaScript(`(${pagecode.detectCode()})()`);
    assert.ok(detected.loadMore);assert.equal(await wc.executeJavaScript(`document.querySelector(${JSON.stringify(detected.loadMore.selector)}).id`),'loadmore');
    const match=detected.candidates.find(item=>item.count===12);
    assert.ok(match,'识别必须包含全部加载出的列表项');
    await wc.executeJavaScript(`(${pagecode.highlightCode()})(${JSON.stringify(match)},true)`);
    assert.ok(await wc.executeJavaScript(`document.querySelectorAll('[data-v6hl]').length===12`));
    console.log('PASS: main lazy list 4 -> 12, inner lazy list 3 -> 9, returned to top, then detected and highlighted; '+(Date.now()-started)+'ms');
    const chosen=await wc.executeJavaScript(`(() => {
      window.__pickEvents=[]; window.__v6={send:(type,payload)=>window.__pickEvents.push({type,payload})};
      document.querySelector('#items').innerHTML=Array.from({length:100},(_,i)=>'<article><h3>商品 '+i+'</h3><p>商品说明内容</p><b>'+i+'</b></article>').join('');
      (${pagecode.pickCode()})(true);
      document.querySelector('#items h3').click();
      document.querySelector('#__v6-selection [data-action=parent]').click();
      if(!document.querySelector('article').hasAttribute('data-v6-selected')) throw Error('外层选择失败');
      document.querySelector('#items').click();
      document.querySelector('#__v6-selection [data-action=children]').click();
      if(window.__pickEvents.some(event=>event.type==='pick-action')) throw Error('选择阶段不得写入规则');
      if(document.querySelectorAll('[data-v6-selected]').length!==100) throw Error('临时选择数量错误');
      document.querySelector('#__v6-selection [data-action=extract-text]').click();
      return window.__pickEvents.findLast(event=>event.type==='pick-action').payload;
    })()`);
    assert.equal(chosen.childCount,100);assert.equal(chosen.role,'extract-text');
    const childList=await wc.executeJavaScript(`(${pagecode.resolvePickCode()})(${JSON.stringify(chosen.path)},${JSON.stringify(chosen.role)},{},${JSON.stringify(chosen.selectionList)})`);
    assert.equal(childList.count,100);
    assert.equal(childList.fields.length,1);
    assert.ok(childList.samples[0][0].includes('商品 0'));
    const appended=await wc.executeJavaScript(`(${pagecode.resolvePickCode()})('#items article h3','extract-text',${JSON.stringify(childList)})`);
    assert.equal(appended.fields.length,2);
    assert.deepEqual(appended.samples[0],[childList.samples[0][0],'商品 0']);
    await wc.executeJavaScript(`document.querySelector('#items').click();document.querySelector('#__v6-selection [data-action=children]').click();document.querySelector('#__v6-selection [data-action=back]').click();`);
    assert.equal(await wc.executeJavaScript(`document.querySelectorAll('[data-v6-selected]').length`),1);
    await wc.executeJavaScript(`document.querySelector('#__v6-selection [data-action=cancel]').click()`);
    assert.equal(await wc.executeJavaScript(`document.querySelectorAll('[data-v6-selected]').length`),0);
    assert.equal(await wc.executeJavaScript(`!!window.__v6pick`),true);
    for(const format of ['innerHtml','html']) {
      const result=await wc.executeJavaScript(`(${pagecode.resolvePickCode()})(${JSON.stringify(chosen.path)},'extract-${format}',{},${JSON.stringify(chosen.selectionList)})`);
      assert.equal(result.samples[0][0].startsWith('<article'),format==='html');
      assert.ok(result.samples[0][0].includes('<h3>商品 0</h3>'));
    }
    await wc.executeJavaScript(`(${pagecode.highlightCode()})(${JSON.stringify(childList)},true)`);
    assert.equal(await wc.executeJavaScript(`document.querySelectorAll('[data-v6hl]').length`),100);
    await wc.executeJavaScript(`(${pagecode.pickCode()})(false)`);
    assert.equal(await wc.executeJavaScript(`document.querySelector('#__v6-selection')`),null);
    console.log('PASS: select parent, outer container -> all 100 children, all 100 highlighted, popup cleanup');
    await wc.executeJavaScript(`document.body.style.height='1000000px'`);
    const scanPromise=wc.executeJavaScript(`(${pagecode.prepareDetectCode()})({waitMs:1000,maxMs:15000})`);
    await new Promise(resolve=>setTimeout(resolve,200));
    const stopAt=Date.now();
    await wc.executeJavaScript('window.__v6detectStopped=true');
    const stopped=await scanPromise;
    assert.equal(stopped.cancelled,true);assert.ok(Date.now()-stopAt<1000);
    const limited=await wc.executeJavaScript(`(${pagecode.prepareDetectCode()})({waitMs:100,maxMs:1000})`);
    assert.equal(limited.limited,true);
    console.log('PASS: cancellation under 1 second and time-limit result flagged');
    app.exit(0);
  } catch(error) {console.error(error);app.exit(1);}
});
