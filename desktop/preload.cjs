const { contextBridge, ipcRenderer } = require('electron');

const capabilities = Object.freeze([
  'filesystem.read',
  'filesystem.list',
  'filesystem.write',
  'filesystem.search',
  'shell.run',
  'test.run',
  'git.status',
  'git.diff',
]);

contextBridge.exposeInMainWorld('miraDesktop', Object.freeze({
  platform: process.platform,
  capabilities,
  chooseWorkspace: () => ipcRenderer.invoke('mira:choose-workspace'),
  getRuntimeInfo: () => ipcRenderer.invoke('mira:runtime-info'),
  invokeTool: (call) => ipcRenderer.invoke('mira:invoke-tool', call),
}));
