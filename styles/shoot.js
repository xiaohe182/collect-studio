'use strict';
// 渲染 5 套风格样张为 PNG：electron styles/shoot.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const VARIANTS = [
  ['A', '方案A_墨金工控'],
  ['B', '方案B_晴空蓝白'],
  ['C', '方案C_暗夜极光'],
  ['D', '方案D_纸感编辑部'],
  ['E', '方案E_瑞士精密'],
];

app.whenReady().then(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const html = 'file:///' + path.join(__dirname, 'preview.html').replace(/\\/g, '/');
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
