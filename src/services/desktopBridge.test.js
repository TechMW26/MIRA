import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseDesktopWorkspace,
  appendDesktopWorkspaceTurn,
  executeDesktopTool,
  getDesktopBridge,
  getDesktopPermissionStatus,
  getDesktopRuntimeInfo,
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
  assert.deepEqual(calls, ['accessibility']);
  await assert.rejects(requestDesktopPermission('camera', scope), /unsupported/i);
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
