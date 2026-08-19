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
  const allowed = new Set(['accessibility', 'full-disk-access']);
  if (!allowed.has(permission)) throw new Error('Unsupported desktop permission request.');
  const bridge = getDesktopBridge(scope);
  if (!bridge || typeof bridge.requestPermission !== 'function') {
    throw new Error(bridge
      ? 'Update the installed MIRA desktop app before requesting system permissions.'
      : 'System permissions are available only in the MIRA desktop application.');
  }
  return await bridge.requestPermission(permission);
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
