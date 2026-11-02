const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'v6-layout-profile-')));
require('../main.js');

app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await new Promise(resolve => setTimeout(resolve, 200));
    const wc = win.webContents;
    assert.equal(win.isMenuBarVisible(), false, 'native menu must be removed');
    assert.ok(await wc.executeJavaScript(`!!document.getElementById('btnWindowMaximize')`), 'custom window controls required');
    const read = () => wc.executeJavaScript(`({
      height: document.getElementById('preview').offsetHeight,
      expanded: document.getElementById('btnTogglePreview')?.getAttribute('aria-expanded'),
      tableVisible: document.querySelector('.table-wrap').getBoundingClientRect().height > 0
    })`);
    const expanded = await read();
    assert.equal(expanded.expanded, 'true', 'preview must expose an accessible collapse control');
    const browser = win.contentView.children[0];
    const before = browser.getBounds();
    await wc.executeJavaScript(`document.getElementById('btnTogglePreview').click()`);
    await new Promise(resolve => setTimeout(resolve, 200));
    const collapsed = await read();
    assert.equal(collapsed.expanded, 'false');
    assert.equal(collapsed.tableVisible, false);
    assert.equal(browser.getBounds().height - before.height, expanded.height - collapsed.height);
    fs.writeFileSync(path.join(__dirname, 'shots', 'layout-collapsed.png'), (await wc.capturePage()).toPNG());
    await wc.executeJavaScript(`document.getElementById('btnTogglePreview').click()`);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.deepEqual(await read(), expanded);
    assert.deepEqual(browser.getBounds(), before);
    const dir = path.join(__dirname, 'shots');
    fs.mkdirSync(dir, { recursive: true });
    for (const [width, height] of [[1560, 920], [1100, 640]]) {
      win.setSize(width, height);
      await new Promise(resolve => setTimeout(resolve, 200));
      const geometry = await wc.executeJavaScript(`(() => {
        const p = document.getElementById('preview').getBoundingClientRect();
        const s = document.getElementById('sidebar').getBoundingClientRect();
        const t = document.getElementById('topbar').getBoundingClientRect();
        return { previewTop: p.top, sidebarLeft: s.left, topbarBottom: t.bottom,
          controlsFit: document.getElementById('btnStart').getBoundingClientRect().right <= innerWidth,
          previewControlsFit: document.getElementById('btnTogglePreview').getBoundingClientRect().right <= p.right };
      })()`);
      const bounds = browser.getBounds();
      assert.equal(bounds.y, geometry.topbarBottom);
      assert.equal(bounds.width, geometry.sidebarLeft);
      assert.equal(bounds.y + bounds.height, geometry.previewTop);
      assert.ok(geometry.controlsFit && geometry.previewControlsFit);
      assert.ok(await wc.executeJavaScript(`document.getElementById('btnWindowClose').getBoundingClientRect().right <= innerWidth`));
      fs.writeFileSync(path.join(dir, `layout-${width}.png`), (await wc.capturePage()).toPNG());
    }
    await wc.executeJavaScript(`document.getElementById('btnWindowMaximize').click()`);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(win.isMaximized());
    assert.equal(await wc.executeJavaScript(`document.getElementById('btnWindowMaximize').getAttribute('aria-label')`), '还原');
    await wc.executeJavaScript(`document.getElementById('btnWindowMaximize').click()`);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(win.isMaximized(), false);
    await wc.executeJavaScript(`document.getElementById('btnWindowMinimize').click()`);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.ok(win.isMinimized());
    win.restore();
    let closeRequested = false;
    win.once('close', event => { event.preventDefault(); closeRequested = true; });
    await wc.executeJavaScript(`document.getElementById('btnWindowClose').click()`);
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(closeRequested);
    console.log('PASS: custom window controls, menu removed, collapse/expand and both window sizes');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
