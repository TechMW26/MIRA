import assert from 'node:assert/strict';
import test from 'node:test';
import queueModule from '../../desktop/permissionOnboarding.cjs';

const { runSequentialPermissionQueue } = queueModule;

test('desktop preload permission queue waits and retries strictly in order', async () => {
  const calls = [];
  const states = {};
  const result = await runSequentialPermissionQueue({
    platform: 'win32',
    getStatus: async () => ({ platform: 'win32', screenCapture: 'granted', ...states }),
    request: async (permission, attempt) => {
      calls.push(`${permission}:${attempt}:request`);
      if (permission === 'microphone' && attempt === 1) return { microphone: 'denied' };
      if (permission === 'full-disk-access') return { settingsOpened: true };
      states[permission === 'location' ? 'location' : permission] = 'granted';
      return states;
    },
    waitForSettingsReturn: async (permission) => calls.push(`${permission}:wait`),
  });
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(calls, [
    'microphone:1:request',
    'microphone:2:request',
    'camera:1:request',
    'location:1:request',
    'full-disk-access:1:request',
    'full-disk-access:wait',
  ]);
});

test('desktop preload queue preserves a successful browser-managed grant', async () => {
  const status = {
    microphone: 'granted',
    camera: 'granted',
    location: 'managed-by-web-permission',
    screenCapture: 'granted',
    fullDiskAccess: false,
  };
  const requested = [];
  const result = await runSequentialPermissionQueue({
    platform: 'win32',
    getStatus: async () => ({ ...status }),
    request: async (permission) => {
      requested.push(permission);
      if (permission === 'location') return { location: 'granted' };
      return { settingsOpened: true };
    },
    waitForSettingsReturn: async () => {},
  });

  assert.deepEqual(requested, ['location', 'full-disk-access']);
  assert.deepEqual(result.unresolved, []);
  assert.ok(result.completed.includes('location'));
});
