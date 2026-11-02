const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const { Scraper } = require('../engine/orchestrator');
const Workflow = require('../engine/workflow');
app.setPath('userData', require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'v6-stop-profile-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false});
  try {
    await win.loadURL('data:text/html,<body style="height:100000px"><article>one</article></body>');
    const flow=Workflow.defaults().slice(1); flow[0].children.pop();
    let emitted=0, error;
    const scraper=new Scraper(win,{
      cfg:{flow,list:{type:'css',selector:'article'},fields:[{name:'text',type:'text',rel:':scope'}]},
      opts:{maxPages:1,scrollLoad:true,maxScrollSec:40,scrollWait:3000},
      onRows:rows=>{emitted+=rows.length;},onError:value=>{error=value;}
    });
    const running=scraper.run();
    await new Promise(resolve=>setTimeout(resolve,500));
    const started=Date.now(); scraper.stop();
    await Promise.race([running,new Promise((_,reject)=>setTimeout(()=>reject(Error('停止滚动采集超过 2 秒')),2000))]);
    assert.equal(error,undefined); assert.equal(emitted,1);
    console.log('PASS: stopped long scroll wait in '+(Date.now()-started)+'ms; already harvested row retained after stop');
    app.exit(0);
  } catch(error) {console.error(error);app.exit(1);}
});
