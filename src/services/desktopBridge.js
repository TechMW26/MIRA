import { DESKTOP_AGENT_CAPABILITIES } from './agentCapabilities.js';

export function getDesktopBridge(scope = globalThis) {
  const bridge = scope?.window?.miraDesktop;
  if (!bridge || typeof bridge.invokeTool !== 'function') return null;
  return bridge;
}

export async function getDesktopRuntimeInfo(scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.getRuntimeInfo !== 'function') return null;
  return await bridge.getRuntimeInfo();
}

export async function chooseDesktopWorkspace(scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.chooseWorkspace !== 'function') {
    throw new Error('Workspace selection is available only in the MIRA desktop application.');
  }
  return await bridge.chooseWorkspace();
}

export async function getDesktopPermissionStatus(scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge) return null;
  if (typeof bridge.getPermissionStatus !== 'function') {
    return {
      available: false,
      updateRequired: true,
      platform: bridge.platform || null,
      bridgeVersion: Number(bridge.bridgeVersion || 0),
    };
  }
  const status = { available: true, ...await bridge.getPermissionStatus() };
  const navigatorObject = scope?.navigator || scope?.window?.navigator;
  if (navigatorObject?.permissions?.query) {
    const browserPermissions = [
      ['geolocation', 'location'],
      ['camera', 'camera'],
      ['microphone', 'microphone'],
    ];
    await Promise.all(browserPermissions.map(async ([name, key]) => {
      try {
        const result = await navigatorObject.permissions.query({ name });
        if (result?.state && result.state !== 'prompt') status[key] = result.state;
      } catch {}
    }));
  }
  return status;
}

function browserPermissionRequest(permission, navigatorObject) {
  if (permission === 'location') {
    if (!navigatorObject?.geolocation?.getCurrentPosition) {
      return Promise.reject(new Error('Location access is not supported by this system.'));
    }
    return new Promise((resolve, reject) => {
      navigatorObject.geolocation.getCurrentPosition(
        () => resolve(),
        (error) => reject(new Error(error?.message || 'Location access was denied.')),
        { enableHighAccuracy: false, timeout: 20_000, maximumAge: 0 },
      );
    });
  }
  if (permission === 'camera' || permission === 'microphone') {
    if (!navigatorObject?.mediaDevices?.getUserMedia) {
      return Promise.reject(new Error(`${permission} access is not supported by this system.`));
    }
    return navigatorObject.mediaDevices.getUserMedia({
      video: permission === 'camera',
      audio: permission === 'microphone',
    }).then((stream) => {
      stream?.getTracks?.().forEach((track) => track.stop());
    });
  }
  return Promise.resolve();
}

export function isDesktopPermissionGranted(permission, status = {}) {
  const key = ({
    accessibility: 'accessibility',
    'full-disk-access': 'fullDiskAccess',
    'screen-capture': 'screenCapture',
    camera: 'camera',
    microphone: 'microphone',
    location: 'location',
    notifications: 'notifications',
  })[permission];
  const value = status?.[key];
  if (permission === 'accessibility') return value === true || value === 'not-required';
  if (permission === 'screen-capture') return ['granted', 'available', 'not-required'].includes(value);
  return value === true || value === 'granted' || value === 'not-required';
}

export async function requestDesktopPermission(permission, scope = globalThis) {
  const allowed = new Set(['accessibility', 'full-disk-access', 'screen-capture', 'camera', 'microphone', 'location', 'notifications']);
  if (!allowed.has(permission)) throw new Error('Unsupported desktop permission request.');
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.requestPermission !== 'function') {
    throw new Error(bridge
      ? 'Update the installed MIRA desktop app before requesting system permissions.'
      : 'System permissions are available only in the MIRA desktop application.');
  }
  const navigatorObject = scope?.navigator || scope?.window?.navigator;
  const browserManaged = permission === 'location'
    || (bridge.platform === 'win32' && (permission === 'camera' || permission === 'microphone'));
  if (browserManaged) {
    try {
      await browserPermissionRequest(permission, navigatorObject);
      return await getDesktopPermissionStatus(scope);
    } catch (error) {
      const next = await bridge.requestPermission(permission);
      const key = permission === 'location' ? 'location' : permission;
      return { available: true, ...next, [key]: 'denied', permissionError: error?.message || `${permission} access was denied.` };
    }
  }
  return await bridge.requestPermission(permission);
}

export async function sendDesktopNotification({ title = 'MIRA', body = '', silent = false } = {}, scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.notify !== 'function') return { shown: false, reason: 'web' };
  const cleanBody = String(body || '').replace(/\s+/g, ' ').trim();
  if (!cleanBody) return { shown: false, reason: 'empty' };
  try {
    return await bridge.notify({ title: String(title || 'MIRA'), body: cleanBody, silent: Boolean(silent) });
  } catch {
    return { shown: false, reason: 'failed' };
  }
}

export async function getDesktopProviderStatus(scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.getProviderStatus !== 'function') return null;
  return await bridge.getProviderStatus();
}

export async function configureDesktopDeepSeek(key, scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.configureDeepSeek !== 'function') {
    throw new Error('Update the installed MIRA desktop app before configuring the coding provider.');
  }
  const result = await bridge.configureDeepSeek(String(key || ''));
  if (!result?.ok) {
    const error = new Error(result?.error || 'Could not configure the coding provider.');
    error.code = result?.code || '';
    throw error;
  }
  return result.status;
}

export async function requestDesktopAgentChat(payload, scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.requestAgentChat !== 'function') return null;
  const result = await bridge.requestAgentChat(payload);
  if (!result?.ok) {
    const error = new Error(result?.error || 'The desktop coding provider is unavailable.');
    error.code = result?.code || '';
    throw error;
  }
  return result;
}

export async function requestDesktopCodeAssist(payload, scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.requestCodeAssist !== 'function') return null;
  const result = await bridge.requestCodeAssist(payload);
  if (!result?.ok) {
    const error = new Error(result?.error || 'The desktop coding assistant is unavailable.');
    error.code = result?.code || '';
    throw error;
  }
  return result;
}

export function notifyDesktopProviderRequired(error, scope = globalThis) {
  if (error?.code !== 'provider_reconnect_required') return false;
  const EventConstructor = scope?.CustomEvent;
  const target = scope?.window;
  if (typeof EventConstructor !== 'function' || typeof target?.dispatchEvent !== 'function') return false;
  target.dispatchEvent(new EventConstructor('mira:desktop-provider-required', {
    detail: { code: error.code, message: error.message },
  }));
  return true;
}

export async function getDesktopWorkspaceMemory(scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.getWorkspaceMemory !== 'function') return null;
  return await bridge.getWorkspaceMemory();
}

export async function appendDesktopWorkspaceTurn(turn, scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.appendWorkspaceTurn !== 'function') return { saved: false };
  return await bridge.appendWorkspaceTurn(turn);
}

export async function saveDesktopWorkspaceFile(path, content, scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.saveWorkspaceFile !== 'function') {
    throw new Error('Workspace file saving is available only in the latest MIRA desktop application.');
  }
  const result = await bridge.saveWorkspaceFile({ path, content });
  if (!result?.ok) throw new Error(result?.error || 'Could not save the workspace file.');
  return String(result.output || '');
}

export function subscribeDesktopSaveShortcut(listener, scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.onSaveShortcut !== 'function') return () => {};
  return bridge.onSaveShortcut(listener);
}

export async function executeDesktopTool(call, scope = globalThis) {
  const name = String(call?.name || '');
  if (!DESKTOP_AGENT_CAPABILITIES.includes(name)) {
    throw new Error(`Unsupported desktop tool: ${name || 'unknown'}`);
  }
  const bridge = getDesktopBridge(scope);
  if (!bridge) throw new Error('This operation is available only in the MIRA desktop application.');
  const result = await bridge.invokeTool({
    name,
    arguments: call?.arguments && typeof call.arguments === 'object' ? call.arguments : {},
  });
  if (!result?.ok) throw new Error(result?.error || 'The desktop operation failed.');
  return String(result.output || '(operation completed without output)');
}
