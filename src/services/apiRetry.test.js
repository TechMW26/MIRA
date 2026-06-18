import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_REQUEST_TIMEOUTS,
  getChatTimeoutMessage,
  getResponseHeadersTimeout,
  getRetryModel,
} from './chatRequestPolicy.js';

test('uses a cross-model recovery ladder after empty responses', () => {
  assert.equal(getRetryModel('mira-lite', 1), 'mira-lite');
  assert.equal(getRetryModel('mira-lite', 2), 'mira');
  assert.equal(getRetryModel('mira-lite', 3), 'mira-pro');
  assert.equal(getRetryModel('mira', 2), 'mira');
  assert.equal(getRetryModel('mira-v4', 3), 'mira-v4');
});

test('keeps Locked retries on the Locked route', () => {
  assert.equal(getRetryModel('locked', 2), 'locked');
  assert.equal(getRetryModel('locked', 3), 'locked');
});

test('uses bounded phase-aware timeouts instead of an unbounded response wait', () => {
  assert.ok(CHAT_REQUEST_TIMEOUTS.responseHeadersMs > 0);
  assert.ok(CHAT_REQUEST_TIMEOUTS.streamIdleMs > CHAT_REQUEST_TIMEOUTS.responseHeadersMs);
  assert.ok(CHAT_REQUEST_TIMEOUTS.totalAttemptMs > CHAT_REQUEST_TIMEOUTS.streamIdleMs);
  assert.ok(getResponseHeadersTimeout('mira-v4') > getResponseHeadersTimeout('mira-lite'));
  assert.match(getChatTimeoutMessage('stream-idle'), /stalled/i);
});
