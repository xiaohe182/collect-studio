const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict');
const {Scraper}=require('../engine/orchestrator');
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});try{
 await win.loadURL('data:text/html,<body><button id="ready">ready</button><div id="host"></div></body>');
 const run=s=>win.webContents.executeJavaScript(s),logs=[];let error;
 await run(`window.clicks=0;document.querySelector('#ready').onclick=()=>clicks++;setTimeout(()=>{document.querySelector('#host').innerHTML='<input id="late"><button id="disabled" disabled>submit</button>';document.querySelector('#disabled').onclick=()=>clicks++;setTimeout(()=>document.querySelector('#disabled').disabled=false,300);},300)`);
 const scraper=new Scraper(win,{cfg:{fields:[],flow:[{id:'ready',type:'click',name:'就绪按钮',params:{selector:'#ready'}},{id:'late',type:'input',name:'延迟输入',params:{selector:'#late',value:'test'}},{id:'disabled',type:'click',name:'禁用按钮',params:{selector:'#disabled'}}]},onError:e=>error=e,onLog:s=>logs.push(s)});
 const start=Date.now();await scraper.run();assert.equal(error,undefined);assert.equal(await run('clicks'),2);assert.equal(await run(`document.querySelector('#late').value`),'test');assert.ok(Date.now()-start<1800);assert.ok(logs.some(s=>s.includes('已就绪')));
 const invalid=Date.now();const result=await scraper.runAction({type:'click',params:{selector:'[',timeout:8}},{fields:[]});assert.equal(result.ok,false);assert.ok(Date.now()-invalid<400);
 await run(`document.querySelector('#host').innerHTML='<button class="duplicate">1</button><button class="duplicate">2</button>'`);
 const ambiguous=await scraper.runAction({type:'click',params:{selector:'.duplicate'}},{fields:[]});assert.match(ambiguous.error,/多个可见元素/);
 await run(`document.querySelector('#host').innerHTML='<button id="covered">target</button><div id="mask" style="position:fixed;inset:0;background:white;z-index:9"></div>';document.querySelector('#covered').onclick=()=>clicks++;setTimeout(()=>document.querySelector('#mask').remove(),300)`);
 assert.equal((await scraper.runAction({type:'click',params:{selector:'#covered'}},{fields:[]})).ok,true);assert.equal(await run('clicks'),3);
 console.log('PASS: immediate and delayed actions, disabled and covered controls, exactly-once clicks, invalid/ambiguous selectors fail fast; three-step flow under 1.8 seconds');app.exit(0);
}catch(e){console.error(e);app.exit(1);}});
