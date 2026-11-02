'use strict';
const pagecode = require('./pagecode');
// Chromium native Enter also triggers form default actions, unlike synthetic keys.
async function executeInput(wc, params, cfg, itemIndex, runAction, checkpoint=async()=>{}) {
  const entries = params.entries || [params];
  if (!entries.length) return {ok:false,error:'请配置输入框'};
  for (const entry of entries) {
    await checkpoint();
    const action = {type:'input',params:{timeout:params.timeout,...entry,focus:true}};
    const result = runAction ? await runAction(action) : await wc.executeJavaScript(`(${pagecode.flowActionCode()})(${JSON.stringify(action)},${JSON.stringify(cfg || {})},${JSON.stringify(itemIndex ?? null)})`,true);
    if (result?.ok === false) return result;
  }
  if (params.enter) {
    await checkpoint();
    // 原生输入直接投递到目标渲染器，隐藏的执行网页不依赖外层窗口焦点。
    // 保留 keyCode、keypress、keyup 和浏览器默认表单行为，不手动提交表单。
    const attachedHere=!wc.debugger.isAttached();
    try {
      if(attachedHere)wc.debugger.attach('1.3');
      await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
      wc.focus();
      await wc.debugger.sendCommand('Page.bringToFront');
      await new Promise(resolve=>setTimeout(resolve,100));
      await checkpoint();
      const key={key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13};
      await wc.debugger.sendCommand('Input.dispatchKeyEvent',{...key,type:'rawKeyDown'});
      await wc.debugger.sendCommand('Input.dispatchKeyEvent',{...key,type:'char',text:'\r',unmodifiedText:'\r'});
      await wc.debugger.sendCommand('Input.dispatchKeyEvent',{...key,type:'keyUp'});
      await new Promise(resolve=>setTimeout(resolve,100));
    } finally {
      if(wc.debugger.isAttached())await wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:false}).catch(()=>{});
      if(attachedHere&&wc.debugger.isAttached())wc.debugger.detach();
    }
  }
  return {ok:true};
}
module.exports = {executeInput};
