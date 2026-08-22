import assert from 'node:assert/strict';
import test from 'node:test';
import { getDesktopPermissionSequence } from './desktopPermissions.js';

test('desktop permissions are ordered sequentially for each operating system', () => {
  assert.deepEqual(
    getDesktopPermissionSequence('darwin').map((item) => item.id),
    ['microphone', 'camera', 'location', 'screen-capture', 'accessibility', 'full-disk-access'],
  );
  assert.deepEqual(
    getDesktopPermissionSequence('win32').map((item) => item.id),
    ['microphone', 'camera', 'location', 'screen-capture', 'full-disk-access'],
  );
});
