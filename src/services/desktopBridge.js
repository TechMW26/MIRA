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
  const status = await bridge.getPermissionStatus();
  return { available: true, ...status };
}

export async function requestDesktopPermission(permission, scope = globalThis) {
  const allowed = new Set(['accessibility', 'full-disk-access', 'screen-capture', 'camera', 'microphone']);
  if (!allowed.has(permission)) throw new Error('Unsupported desktop permission request.');
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.requestPermission !== 'function') {
    throw new Error(bridge
      ? 'Update the installed MIRA desktop app before requesting system permissions.'
      : 'System permissions are available only in the MIRA desktop application.');
  }
  return await bridge.requestPermission(permission);
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
  if (!result?.ok) throw new Error(result?.error || 'Could not configure the coding provider.');
  return result.status;
}

export async function requestDesktopAgentChat(payload, scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.requestAgentChat !== 'function') return null;
  const result = await bridge.requestAgentChat(payload);
  if (!result?.ok) throw new Error(result?.error || 'The desktop coding provider is unavailable.');
  return result;
}

export async function requestDesktopCodeAssist(payload, scope = globalThis) {
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.requestCodeAssist !== 'function') return null;
  const result = await bridge.requestCodeAssist(payload);
  if (!result?.ok) throw new Error(result?.error || 'The desktop coding assistant is unavailable.');
  return result;
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
