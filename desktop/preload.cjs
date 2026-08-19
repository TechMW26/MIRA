const { contextBridge, ipcRenderer } = require('electron');

const capabilities = Object.freeze([
  'filesystem.read',
  'filesystem.list',
  'filesystem.write',
  'filesystem.search',
  'filesystem.preview',
  'workspace.index',
  'workspace.search',
  'shell.run',
  'shell.cancel',
  'test.run',
  'git.status',
  'git.diff',
  'git.info',
  'git.pull',
  'git.push',
  'git.commit',
  'git.remote.set',
  'change.list',
  'change.undo',
  'change.redo',
  'approval.status',
  'approval.set',
]);

contextBridge.exposeInMainWorld('miraDesktop', Object.freeze({
  bridgeVersion: 6,
  platform: process.platform,
  capabilities,
  chooseWorkspace: () => ipcRenderer.invoke('mira:choose-workspace'),
  getRuntimeInfo: () => ipcRenderer.invoke('mira:runtime-info'),
  getPermissionStatus: () => ipcRenderer.invoke('mira:permission-status'),
  requestPermission: (permission) => ipcRenderer.invoke('mira:request-permission', permission),
  getWorkspaceMemory: () => ipcRenderer.invoke('mira:workspace-memory'),
  appendWorkspaceTurn: (turn) => ipcRenderer.invoke('mira:append-workspace-turn', turn),
  saveWorkspaceFile: (payload) => ipcRenderer.invoke('mira:save-workspace-file', payload),
  invokeTool: (call) => ipcRenderer.invoke('mira:invoke-tool', call),
  onSaveShortcut: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = () => listener();
    ipcRenderer.on('mira:save-current-file', handler);
    return () => ipcRenderer.removeListener('mira:save-current-file', handler);
  },
  onTerminalOutput: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('mira:terminal-output', handler);
    return () => ipcRenderer.removeListener('mira:terminal-output', handler);
  },
}));
