const { contextBridge, ipcRenderer } = require('electron');

// Sandboxed Electron preloads can only require a small built-in module set.
// Keep this queue self-contained so a relative require cannot prevent the
// entire desktop bridge from being exposed.
const permissionVersion = 'v3';

function permissionSequence(platform) {
  const shared = ['notifications', 'microphone', 'camera', 'location', 'screen-capture'];
  if (platform === 'darwin') return [...shared, 'accessibility', 'full-disk-access'];
  if (platform === 'win32') return [...shared, 'full-disk-access'];
  return shared;
}

function permissionStatusKey(permission) {
  return ({
    accessibility: 'accessibility',
    'full-disk-access': 'fullDiskAccess',
    'screen-capture': 'screenCapture',
    camera: 'camera',
    microphone: 'microphone',
    location: 'location',
    notifications: 'notifications',
  })[permission];
}

function permissionGranted(permission, status = {}) {
  const value = status[permissionStatusKey(permission)];
  if (permission === 'accessibility') return value === true || value === 'not-required';
  if (permission === 'screen-capture') return ['granted', 'available', 'not-required'].includes(value);
  return value === true || value === 'granted' || value === 'not-required';
}

async function runSequentialPermissionQueue({
  platform,
  getStatus,
  request,
  waitForSettingsReturn = async () => {},
  attempts = 2,
} = {}) {
  const unresolved = [];
  const completed = [];
  for (const permission of permissionSequence(platform)) {
    let status = await getStatus();
    if (permissionGranted(permission, status)) {
      completed.push(permission);
      continue;
    }
    let acknowledgedSettings = false;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const result = await request(permission, attempt).catch((error) => ({
        permissionError: error?.message || String(error || 'Permission request failed.'),
      }));
      if (result?.settingsOpened) {
        acknowledgedSettings = permission === 'full-disk-access';
        await waitForSettingsReturn(permission);
      }
      const refreshedStatus = await getStatus().catch(() => ({}));
      status = { ...refreshedStatus, ...(result || {}) };
      if (permissionGranted(permission, status) || acknowledgedSettings) break;
    }
    if (permissionGranted(permission, status) || acknowledgedSettings) completed.push(permission);
    else unresolved.push(permission);
  }
  return { completed, unresolved };
}

const capabilities = Object.freeze([
  'filesystem.read',
  'filesystem.list',
  'filesystem.write',
  'filesystem.replace',
  'filesystem.search',
  'filesystem.preview',
  'workspace.index',
  'workspace.search',
  'workspace.validate',
  'workspace.start',
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
  bridgeVersion: 14,
  platform: process.platform,
  capabilities,
  chooseWorkspace: () => ipcRenderer.invoke('mira:choose-workspace'),
  getRuntimeInfo: () => ipcRenderer.invoke('mira:runtime-info'),
  getPermissionStatus: () => ipcRenderer.invoke('mira:permission-status'),
  requestPermission: (permission) => ipcRenderer.invoke('mira:request-permission', permission),
  getProviderStatus: () => ipcRenderer.invoke('mira:provider-status'),
  configureDeepSeek: (key) => ipcRenderer.invoke('mira:configure-deepseek', key),
  requestAgentChat: (payload) => ipcRenderer.invoke('mira:agent-chat', payload),
  requestCodeAssist: (payload) => ipcRenderer.invoke('mira:code-assist', payload),
  setCompanionExpanded: (expanded) => ipcRenderer.invoke('mira:companion-expanded', Boolean(expanded)),
  moveCompanion: (point) => ipcRenderer.invoke('mira:companion-move', point),
  captureCompanionScreen: () => ipcRenderer.invoke('mira:companion-capture-screen'),
  openMainWindow: () => ipcRenderer.invoke('mira:open-main-window'),
  notify: (payload) => ipcRenderer.invoke('mira:notify', payload),
  onCompanionState: (listener) => {
    if (typeof listener !== 'function') return () => {};
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on('mira:companion-state', handler);
    return () => ipcRenderer.removeListener('mira:companion-state', handler);
  },
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

function waitForSettingsReturn(timeoutMs = 90_000) {
  return new Promise((resolve) => {
    let blurred = !document.hasFocus();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      resolve();
    };
    const onBlur = () => { blurred = true; };
    const onFocus = () => { if (blurred) setTimeout(finish, 500); };
    const timer = setTimeout(finish, timeoutMs);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
  });
}

function requestBrowserPermission(permission) {
  if (permission === 'location') {
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => reject(new Error(error?.message || 'Location access was denied.')),
      { enableHighAccuracy: false, timeout: 20_000, maximumAge: 0 },
    ));
  }
  if (permission === 'camera' || permission === 'microphone') {
    return navigator.mediaDevices.getUserMedia({
      video: permission === 'camera',
      audio: permission === 'microphone',
    }).then((stream) => stream.getTracks().forEach((track) => track.stop()));
  }
  return Promise.resolve();
}

window.addEventListener('DOMContentLoaded', () => {
  const companion = new URLSearchParams(window.location.search).get('desktopCompanion') === '1';
  if (companion) return;
  const completedKey = `mira-desktop-permissions-completed-${permissionVersion}`;
  const retryKey = `mira-desktop-permissions-retry-${permissionVersion}`;
  const runningKey = `mira-desktop-permissions-running-${permissionVersion}`;
  if (localStorage.getItem(completedKey) === 'yes' || sessionStorage.getItem(runningKey) === 'yes') return;
  sessionStorage.setItem(runningKey, 'yes');
  const platform = process.platform;
  const getStatus = () => ipcRenderer.invoke('mira:permission-status');
  const request = async (permission) => {
    const browserManaged = permission === 'location'
      || (platform === 'win32' && (permission === 'camera' || permission === 'microphone'));
    if (browserManaged) {
      try {
        await requestBrowserPermission(permission);
        return { ...(await getStatus()), [permission]: 'granted' };
      } catch {
        return await ipcRenderer.invoke('mira:request-permission', permission);
      }
    }
    return await ipcRenderer.invoke('mira:request-permission', permission);
  };
  runSequentialPermissionQueue({ platform, getStatus, request, waitForSettingsReturn })
    .then(({ unresolved }) => {
      if (unresolved.length) {
        localStorage.setItem(retryKey, JSON.stringify(unresolved));
        localStorage.removeItem(completedKey);
      } else {
        localStorage.setItem(completedKey, 'yes');
        localStorage.removeItem(retryKey);
      }
    })
    .catch(() => {})
    .finally(() => sessionStorage.removeItem(runningKey));
});
