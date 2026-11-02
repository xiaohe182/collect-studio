'use strict';
// 渲染 5 套纯白风格样张：electron styles/shoot-white.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const VARIANTS = [
  ['W1', '纯白方案W1_极简留白'],
  ['W2', '纯白方案W2_图纸线框'],
  ['W3', '纯白方案W3_圆润柔和'],
  ['W4', '纯白方案W4_衬线文人'],
  ['W5', '纯白方案W5_极黑白'],
];

app.whenReady().then(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const html = 'file:///' + path.join(__dirname, 'preview-white.html').replace(/\\/g, '/');
  const win = new BrowserWindow({
    width: 1440, height: 900, useContentSize: true, show: true,
    title: 'styles', backgroundColor: '#ffffff',
  });
  for (const [v, name] of VARIANTS) {
    await win.loadURL(html + '?v=' + v);
    await sleep(1000);
    let img = await win.webContents.capturePage();
    if (img.isEmpty()) { await sleep(800); img = await win.webContents.capturePage(); }
    fs.writeFileSync(path.join(__dirname, name + '.png'), img.toPNG());
    console.log('SHOT ' + name + ' ' + img.getSize().width + 'x' + img.getSize().height);
  }
  app.exit(0);
});
