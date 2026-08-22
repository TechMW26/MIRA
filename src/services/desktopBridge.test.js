import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseDesktopWorkspace,
  appendDesktopWorkspaceTurn,
  executeDesktopTool,
  configureDesktopDeepSeek,
  getDesktopBridge,
  getDesktopPermissionStatus,
  getDesktopProviderStatus,
  getDesktopRuntimeInfo,
  notifyDesktopProviderRequired,
  requestDesktopAgentChat,
  requestDesktopCodeAssist,
  requestDesktopPermission,
  saveDesktopWorkspaceFile,
  subscribeDesktopSaveShortcut,
} from './desktopBridge.js';

test('desktop bridge is absent in the web runtime', async () => {
  assert.equal(getDesktopBridge({ window: {} }), null);
  await assert.rejects(
    executeDesktopTool({ name: 'shell.run', arguments: { command: 'npm' } }, { window: {} }),
    /desktop application/i,
  );
});

test('desktop workspace helpers remain unavailable on the web', async () => {
  assert.equal(await getDesktopRuntimeInfo({ window: {} }), null);
  assert.equal(await getDesktopPermissionStatus({ window: {} }), null);
  await assert.rejects(chooseDesktopWorkspace({ window: {} }), /desktop application/i);
  await assert.rejects(requestDesktopPermission('accessibility', { window: {} }), /desktop application/i);
  assert.equal(await getDesktopProviderStatus({ window: {} }), null);
  assert.equal(await requestDesktopAgentChat({}, { window: {} }), null);
  assert.equal(await requestDesktopCodeAssist({}, { window: {} }), null);
  await assert.rejects(configureDesktopDeepSeek('secret', { window: {} }), /update the installed/i);
});

test('desktop AI requests cross only the trusted preload bridge', async () => {
  const scope = {
    window: {
      miraDesktop: {
        invokeTool: async () => ({ ok: true }),
        getProviderStatus: async () => ({ deepseekConfigured: true }),
        configureDeepSeek: async () => ({ ok: true, status: { deepseekConfigured: true } }),
        requestAgentChat: async () => ({ ok: true, answer: 'done', toolCalls: [] }),
        requestCodeAssist: async () => ({ ok: true, suggestion: 'return value;' }),
      },
    },
  };
  assert.equal((await getDesktopProviderStatus(scope)).deepseekConfigured, true);
  assert.equal((await configureDesktopDeepSeek('secret', scope)).deepseekConfigured, true);
  assert.equal((await requestDesktopAgentChat({ messages: [] }, scope)).answer, 'done');
  assert.equal((await requestDesktopCodeAssist({ task: 'completion' }, scope)).suggestion, 'return value;');
});

test('desktop AI preserves reconnect errors and notifies the workspace UI', async () => {
  const events = [];
  class TestCustomEvent {
    constructor(type, options) {
      this.type = type;
      this.detail = options.detail;
    }
  }
  const scope = {
    CustomEvent: TestCustomEvent,
    window: {
      dispatchEvent: (event) => events.push(event),
      miraDesktop: {
        invokeTool: async () => ({ ok: true }),
        requestAgentChat: async () => ({
          ok: false,
          code: 'provider_reconnect_required',
          error: 'Reconnect the DeepSeek coding provider under System access.',
        }),
        requestCodeAssist: async () => ({
          ok: false,
          code: 'provider_reconnect_required',
          error: 'Reconnect the DeepSeek coding provider under System access.',
        }),
      },
    },
  };

  for (const request of [requestDesktopAgentChat({ messages: [] }, scope), requestDesktopCodeAssist({}, scope)]) {
    await assert.rejects(request, (error) => {
      assert.equal(error.code, 'provider_reconnect_required');
      assert.match(error.message, /Reconnect the DeepSeek/i);
      return true;
    });
  }
  const reconnectError = new Error('Reconnect the DeepSeek coding provider under System access.');
  reconnectError.code = 'provider_reconnect_required';
  assert.equal(notifyDesktopProviderRequired(reconnectError, scope), true);
  assert.equal(events[0].type, 'mira:desktop-provider-required');
  assert.equal(events[0].detail.code, 'provider_reconnect_required');
});

test('desktop permission requests use only the allowlisted native bridge', async () => {
  const calls = [];
  const scope = {
    window: {
      miraDesktop: {
        invokeTool: async () => ({ ok: true }),
        getPermissionStatus: async () => ({ platform: 'darwin', accessibility: false }),
        requestPermission: async (permission) => {
          calls.push(permission);
          return { platform: 'darwin', accessibility: true };
        },
      },
    },
  };

  assert.equal((await getDesktopPermissionStatus(scope)).accessibility, false);
  assert.equal((await requestDesktopPermission('accessibility', scope)).accessibility, true);
  assert.equal((await requestDesktopPermission('camera', scope)).accessibility, true);
  const locationScope = {
    ...scope,
    navigator: {
      geolocation: { getCurrentPosition: (resolve) => resolve({ coords: {} }) },
    },
  };
  assert.equal((await requestDesktopPermission('location', locationScope)).platform, 'darwin');
  assert.deepEqual(calls, ['accessibility', 'camera']);
  await assert.rejects(requestDesktopPermission('notifications', scope), /unsupported/i);
});

test('outdated desktop shells report an update instead of claiming permissions are unnecessary', async () => {
  const scope = {
    window: {
      miraDesktop: {
        platform: 'darwin',
        invokeTool: async () => ({ ok: true }),
      },
    },
  };

  assert.deepEqual(await getDesktopPermissionStatus(scope), {
    available: false,
    updateRequired: true,
    platform: 'darwin',
    bridgeVersion: 0,
  });
  await assert.rejects(requestDesktopPermission('accessibility', scope), /update the installed/i);
});

test('desktop tool calls cross only the trusted preload bridge', async () => {
  const calls = [];
  const output = await executeDesktopTool(
    { name: 'git.status', arguments: {} },
    {
      window: {
        miraDesktop: {
          invokeTool: async (call) => {
            calls.push(call);
            return { ok: true, output: 'clean' };
          },
        },
      },
    },
  );
  assert.equal(output, 'clean');
  assert.deepEqual(calls, [{ name: 'git.status', arguments: {} }]);
});

test('desktop editor saves and workspace turns use dedicated native channels', async () => {
  const calls = [];
  const listeners = [];
  const scope = {
    window: {
      miraDesktop: {
        invokeTool: async () => ({ ok: true }),
        saveWorkspaceFile: async (payload) => {
          calls.push(['save', payload]);
          return { ok: true, output: 'saved' };
        },
        appendWorkspaceTurn: async (turn) => {
          calls.push(['turn', turn]);
          return { saved: true };
        },
        onSaveShortcut: (listener) => {
          listeners.push(listener);
          return () => listeners.splice(0);
        },
      },
    },
  };

  assert.equal(await saveDesktopWorkspaceFile('src/app.js', 'next', scope), 'saved');
  assert.deepEqual(await appendDesktopWorkspaceTurn({ turnId: 'turn-1' }, scope), { saved: true });
  let shortcuts = 0;
  const unsubscribe = subscribeDesktopSaveShortcut(() => { shortcuts += 1; }, scope);
  listeners[0]();
  unsubscribe();
  assert.equal(shortcuts, 1);
  assert.deepEqual(calls, [
    ['save', { path: 'src/app.js', content: 'next' }],
    ['turn', { turnId: 'turn-1' }],
  ]);
});
