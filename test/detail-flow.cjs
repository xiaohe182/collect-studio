const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const { Scraper } = require('../engine/orchestrator');
const Workflow = require('../engine/workflow');
app.setPath('userData', require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'v6-detail-profile-')));

app.whenReady().then(async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.url.startsWith('/detail/')) {
      res.end(`<body><h1>详情 ${req.url.split('/').pop()}</h1></body>`);
    } else {
      const page = req.url === '/two' ? 2 : 1;
      const order = requests.filter(route => route === req.url).length > 1 ? [2,1] : [1,2];
      res.end(`<body>${order.map(i => `<article><a target="_blank" href="/detail/${page}-${i}">查看详情</a></article>`).join('')}${page === 1 ? '<a rel="next" href="/two">下一页</a>' : ''}</body>`);
    }
  });
  const win = new BrowserWindow({ show: false });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/`;
    const flow = Workflow.defaults();
    const detail = Workflow.node('detail');
    detail.params.selector = 'a';
    flow[1].children[0].children = [detail];
    Workflow.validate(flow);
    assert.notEqual(Workflow.copy(detail).children[0].id, detail.children[0].id);
    const rows = [], errors = [];
    let done;
    const scraper = new Scraper(win, {
      cfg: { url, flow, list: { type: 'css', selector: 'article' }, fields: [{ name: '标题', type: 'text', rel: 'h1' }] },
      opts: { autoNext: true, maxPages: 2, nextWaitSec: 0, scrollLoad: false },
      onRows: values => rows.push(...values), onError: error => errors.push(error), onDone: result => { done = result; }
    });
    await scraper.run();
    assert.deepEqual(errors, []);
    assert.deepEqual(rows, [['详情 1-1'], ['详情 1-2'], ['详情 2-1'], ['详情 2-2']]);
    assert.equal(done.pages, 2);
    assert.equal(win.webContents.getURL(), url + 'two');
    assert.deepEqual(requests.filter(route => route.startsWith('/detail/')), ['/detail/1-1','/detail/1-2','/detail/2-1','/detail/2-2']);
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    console.log('PASS: two list pages, four detail pages, exact rows, return to list, target=_blank stays in same browser');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
  finally { server.close(); }
});
