import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_REQUEST_TIMEOUTS,
  getChatTimeoutMessage,
  getResponseHeadersTimeout,
  isChatTimeoutError,
} from './chatRequestPolicy.js';

test('uses bounded phase-aware timeouts instead of an unbounded response wait', () => {
  assert.ok(CHAT_REQUEST_TIMEOUTS.responseHeadersMs > 0);
  assert.ok(CHAT_REQUEST_TIMEOUTS.streamIdleMs > 0);
  assert.ok(CHAT_REQUEST_TIMEOUTS.totalAttemptMs > CHAT_REQUEST_TIMEOUTS.responseHeadersMs);
  assert.equal(getResponseHeadersTimeout(), CHAT_REQUEST_TIMEOUTS.responseHeadersMs);
  assert.match(getChatTimeoutMessage('stream-idle'), /stalled/i);
});

test('recognizes browser and server model-start timeouts', () => {
  assert.equal(isChatTimeoutError({ name: 'ChatTimeoutError' }), true);
  assert.equal(isChatTimeoutError(new Error('The model is busy and did not begin responding in time.')), true);
  assert.equal(isChatTimeoutError(new Error('A normal request failed.')), false);
});
