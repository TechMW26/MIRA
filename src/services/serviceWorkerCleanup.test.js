import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isLegacyFirebaseMessagingWorker,
  removeLegacyFirebaseMessagingWorkers,
} from './serviceWorkerCleanup.js';

test('identifies only the obsolete Firebase messaging worker', () => {
  assert.equal(isLegacyFirebaseMessagingWorker({
    active: { scriptURL: 'https://mira.test/firebase-messaging-sw.js' },
  }), true);
  assert.equal(isLegacyFirebaseMessagingWorker({
    active: { scriptURL: 'https://mira.test/sw.js' },
  }), false);
});

test('unregisters obsolete messaging workers without touching the PWA worker', async () => {
  let removed = 0;
  const count = await removeLegacyFirebaseMessagingWorkers({
    getRegistrations: async () => [
      { active: { scriptURL: 'https://mira.test/sw.js' }, unregister: async () => false },
      { active: { scriptURL: 'https://mira.test/firebase-messaging-sw.js' }, unregister: async () => { removed += 1; return true; } },
    ],
  });
  assert.equal(count, 1);
  assert.equal(removed, 1);
});
