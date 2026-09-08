import assert from 'node:assert/strict';
import test from 'node:test';
import { isPermanentSessionError, restoreSessionWithRetry } from './authSessionPolicy.js';

test('only explicit authorization failures invalidate a saved session', () => {
  assert.equal(isPermanentSessionError({ status: 401 }), true);
  assert.equal(isPermanentSessionError({ status: 403 }), true);
  assert.equal(isPermanentSessionError({ status: 429, retryable: true }), false);
  assert.equal(isPermanentSessionError({ status: 503, retryable: true }), false);
  assert.equal(isPermanentSessionError({ code: 'auth/network-request-failed', retryable: true }), false);
});

test('session restoration retries transient outages without retrying expired credentials', async () => {
  const attempts = [];
  const waits = [];
  const result = await restoreSessionWithRetry(async (attempt) => {
    attempts.push(attempt);
    if (attempt < 3) throw Object.assign(new Error('temporary'), { status: 503, retryable: true });
    return { user: { uid: 'restored' } };
  }, { wait: async (ms) => waits.push(ms) });
  assert.equal(result.user.uid, 'restored');
  assert.deepEqual(attempts, [1, 2, 3]);
  assert.deepEqual(waits, [250, 500]);

  let permanentAttempts = 0;
  await assert.rejects(
    restoreSessionWithRetry(async () => {
      permanentAttempts += 1;
      throw Object.assign(new Error('expired'), { status: 401 });
    }, { wait: async () => {} }),
    /expired/,
  );
  assert.equal(permanentAttempts, 1);
});
