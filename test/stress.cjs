const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Scraper } = require('../engine/orchestrator');
const Workflow = require('../engine/workflow');
const pagecode = require('../engine/pagecode');
const { exportRows } = require('../engine/exporter');
const XLSX = require('xlsx');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'v6-stress-'));
app.setPath('userData', path.join(output, 'profile'));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  const wc = win.webContents;
  const report = { runs: [], output };
  const server = http.createServer((req, res) => {
    const page = Number(new URL(req.url, 'http://localhost').searchParams.get('page') || 1);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<body><input id="entry"><div>${Array.from({ length: 2000 }, (_, i) => `<article><b>${page}-${i}</b><span>商品 ${i} 中文 "逗号,内容"</span></article>`).join('')}</div>${page < 5 ? `<a rel="next" href="/?page=${page + 1}">下一页</a>` : ''}</body>`);
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const fields = [{name:'编号',type:'text',rel:'b'}, {name:'内容',type:'text',rel:'span'}];
    for (let run = 0; run < 3; run++) {
      const rows = [], errors = [];
      const scraper = new Scraper(win, {
        cfg: {url, flow:Workflow.defaults(),list:{type:'css',selector:'article'},fields},
        opts:{maxPages:5,autoNext:true,scrollLoad:false,nextWaitSec:0,maxRows:10000},
        onRows: batch => rows.push(...batch),onError:error=>errors.push(error)
      });
      const started = Date.now();
      await scraper.run();
      assert.deepEqual(errors, []);
      assert.equal(rows.length, 10000);
      assert.equal(new Set(rows.map(row => row[0])).size, 10000);
      assert.equal(rows[0][0], '1-0'); assert.equal(rows.at(-1)[0], '5-1999');
      const metric = {run:run+1,rows:rows.length,ms:Date.now()-started,mainRssMB:Math.round(process.memoryUsage().rss/1048576)};
      report.runs.push(metric); console.log(JSON.stringify(metric));
      if (run === 2) {
        const exportStart = Date.now();
        for (const format of ['csv','json','xlsx']) {
          const result=exportRows(rows,fields,format,output,'stress'); assert.ok(result.ok,result.error);
          if(format==='json') assert.deepEqual(JSON.parse(fs.readFileSync(result.path,'utf8')).at(-1), {'编号':'5-1999','内容':'商品 1999 中文 "逗号,内容"'});
          else {
            const book = XLSX.readFile(result.path);
            const actual = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{header:1,raw:false});
            assert.equal(actual.length,10001); assert.deepEqual(actual.at(-1),rows.at(-1));
          }
        }
        report.exportsMs=Date.now()-exportStart;
      }
    }
    report.modeSwitches = await wc.executeJavaScript(`(() => {
      const pick = ${pagecode.pickCode()};
      const input=document.querySelector('input');
      for(let i=0;i<100;i++) {
        pick(true);
        if(input.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))) throw Error('选择模式没有拦截');
        pick(false);
        if(!input.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true}))) throw Error('浏览模式仍被拦截');
      }
      return 100;
    })()`);
    fs.writeFileSync(path.join(__dirname,'stress-results.json'),JSON.stringify(report,null,2));
    console.log('PASS: 3 x 10000 rows, exact IDs, CSV/JSON/XLSX readback, 100 mode switches');
    app.exit(0);
  } catch(error) {console.error(error);app.exit(1);}
  finally {server.close();}
});
