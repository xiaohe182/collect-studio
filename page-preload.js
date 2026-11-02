'use strict';
// 目标页面 preload：注入到被采集网页里的最小桥（点选结果回传主进程）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__v6', {
  send: (type, payload) => ipcRenderer.send('page-msg', { type, payload }),
});
