const {app, BrowserWindow} = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const pagecode = require('../engine/pagecode');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'v6-schema-')));
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false});
  const exec = (code, arg) => win.webContents.executeJavaScript(`(${code})(${JSON.stringify(arg)})`);
  try {
    const count = 1000;
    const html = `<body><section id="products">${Array.from({length:count}, (_, i) => `<article class="product"><h3>商品 ${i}</h3>${i % 3 ? `<span itemprop="price">￥${i}</span>` : ''}<span class="stock">库存 ${i}</span><img data-src="https://example.test/${i}.png"><a href="https://example.test/${i}"><svg></svg></a></article>`).join('')}</section></body>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    const start = Date.now();
    const result = await exec(pagecode.detectCode());
    assert.equal(result.ok, true);
    const candidate = result.candidates.find(c => c.count === count && c.list.tag === 'ARTICLE');
    assert.ok(candidate, 'product list discovered');
    const fields = candidate.fields;
    assert.ok(fields.every(f => f.__idx == null), 'no positional fallback on new rules');
    const price = fields.findIndex(f => f.rel.includes('itemprop'));
    const stock = fields.findIndex(f => f.rel.includes('.stock'));
    const image = fields.findIndex(f => f.type === 'img');
    const link = fields.findIndex(f => f.type === 'href');
    assert.ok(price >= 0 && stock >= 0 && image >= 0 && link >= 0);
    const saved = JSON.parse(JSON.stringify(candidate));
    // Execute the normal extraction action using a serialized saved rule.
    const rows = await win.webContents.executeJavaScript(`(${pagecode.flowActionCode()})({type:'extract'},${JSON.stringify(saved)})`);
    // The normal preview path also verifies the persisted rule format.
    const preview = await exec(pagecode.previewCode(), saved);
    assert.ok(preview.rows.length);
    const all = rows.rows;
    assert.equal(all.length, count);
    all.forEach((r, i) => {
      assert.equal(r[price], i % 3 ? '￥' + i : '');
      assert.equal(r[stock], '库存 ' + i);
      assert.equal(r[image], `https://example.test/${i}.png`);
      assert.equal(r[link], `https://example.test/${i}`);
    });
    console.log(`PASS: ${count} records, optional price absent in first record, stock alignment, lazy images, icon links, JSON rule roundtrip (${Date.now()-start}ms)`);
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<body><section>${[0,1,2].map(i => `<article><h3>记录 ${i}</h3>${i % 2 ? '<span class="stock">有货</span><span class="brand">品牌</span>' : '<span class="brand">品牌</span><span class="stock">有货</span>'}<meta itemprop="price" content="${i+10}"></article>`).join('')}</section></body>`));
    const semantic = (await exec(pagecode.detectCode())).candidates.find(c => c.list.tag === 'ARTICLE');
    const values = (await exec(pagecode.previewCode(), semantic)).rows;
    const contentIndex = semantic.fields.findIndex(f => f.attr === 'content');
    assert.ok(contentIndex >= 0);
    values.forEach((r, i) => {
      assert.equal(r[contentIndex], String(i+10));
      assert.equal(r[semantic.fields.findIndex(f => f.rel.includes('.stock'))], '有货');
      assert.equal(r[semantic.fields.findIndex(f => f.rel.includes('.brand'))], '品牌');
    });
    console.log('PASS: reordered fields and itemprop content attributes');
    win.destroy(); app.exit(0);
  } catch (e) { console.error(e); win.destroy(); app.exit(1); }
});
