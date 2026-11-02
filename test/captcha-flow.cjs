const {app,BrowserWindow}=require('electron'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Scraper}=require('../engine/orchestrator'),Workflow=require('../engine/workflow');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'v6-captcha-')));
app.whenReady().then(async()=>{const win=new BrowserWindow({show:false});try{
 await win.loadURL('data:text/html,<body><input id="code"><p>sample</p>');
 const captcha=Workflow.node('captcha');captcha.params={selector:'#code',kind:'image',timeout:5};
 const extract=Workflow.node('extract');let rows=[],completed=false,failed;
 const scraper=new Scraper(win,{cfg:{flow:[captcha,extract],list:{type:'css',selector:'p'},fields:[{name:'text',type:'text',rel:':scope'}]},onRows:r=>rows.push(...r),onDone:()=>completed=true,onError:e=>failed=e});
 const running=scraper.run();const end=Date.now()+3000;while(!await win.webContents.executeJavaScript(`!!document.querySelector('#__v6-captcha')`)&&Date.now()<end)await new Promise(r=>setTimeout(r,50));
 assert.equal(rows.length,0);assert.equal(completed,false);
 await win.webContents.executeJavaScript(`document.querySelector('#__v6-captcha button').click()`);await running;
 assert.equal(failed,undefined);assert.equal(completed,true);assert.deepEqual(rows,[['sample']]);
 const stopped=new Scraper(win,{cfg:{flow:[captcha,extract],list:{type:'css',selector:'p'},fields:[{name:'text',type:'text',rel:':scope'}]},onRows:()=>{throw Error('must not collect after stop');}});
 const stoppedRun=stopped.run();await new Promise(r=>setTimeout(r,300));stopped.stop();await stoppedRun;assert.equal(await win.webContents.executeJavaScript(`!!document.querySelector('#__v6-captcha')`),false);
 console.log('PASS: captcha blocks extraction, explicit continue resumes, stop removes prompt without collecting');win.destroy();app.exit(0);
}catch(e){console.error(e);win.destroy();app.exit(1);}});
