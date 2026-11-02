const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),pc=require('../engine/pagecode');
app.whenReady().then(async()=>{const w=new BrowserWindow({show:false});try{
const html=id=>`<form class="login-form"><input id="el-id-${id}-6" placeholder="手机号码"><input id="el-id-${id}-7" type="password" placeholder="请输入密码"><button id="el-id-${id}-8" type="button" class="login-button">登录</button></form>`;
const run=s=>w.webContents.executeJavaScript(s);
await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html(2954)));
await run(`window.events=[];window.__v6={send:(type,payload)=>events.push({type,payload})};(${pc.pickCode()})(true);document.querySelector('input').click()`);
const account=await run(`events.findLast(e=>e.type==='pick').payload.path`);
await run(`(${pc.pickCode()})(false);(${pc.pickCode()})(true);document.querySelector('input[type=password]').click()`);
const password=await run(`events.findLast(e=>e.type==='pick').payload.path`);
await run(`(${pc.pickCode()})(false);(${pc.pickCode()})(true);document.querySelector('.login-button').click()`);
const button=await run(`events.findLast(e=>e.type==='pick').payload.path`);
for(const selector of [account,password,button])assert.ok(!selector.includes('el-id-'));
await w.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html(9081)));
for(const [selector,value] of [[account,'test-account'],[password,'test-password']]){
const r=await run(`(${pc.flowActionCode()})(${JSON.stringify({type:'input',params:{selector,mode:'css',value}})},{fields:[]},null)`);assert.notEqual(r.ok,false);
}
assert.deepEqual(await run(`Array.from(document.querySelectorAll('input'),e=>e.value)`),['test-account','test-password']);
assert.equal(await run(`document.querySelector(${JSON.stringify(button)}).textContent`),'登录');
console.log('PASS: real picker excludes generated IDs; account/password input and button locator survive page reload with new IDs');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
