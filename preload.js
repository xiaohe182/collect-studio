'use strict';
// 控制面板 preload：面板 UI ←→ 主进程
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('v6api', {
  invoke: (cmd, payload) => ipcRenderer.invoke('panel-cmd', cmd, payload),
  onEvent: (cb) => ipcRenderer.on('panel-event', (_e, evt) => cb(evt)),
});
