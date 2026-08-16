import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_REQUEST_TIMEOUTS,
  getChatTimeoutMessage,
  getResponseHeadersTimeout,
} from './chatRequestPolicy.js';

test('uses bounded phase-aware timeouts instead of an unbounded response wait', () => {
  assert.ok(CHAT_REQUEST_TIMEOUTS.responseHeadersMs > 0);
  assert.ok(CHAT_REQUEST_TIMEOUTS.streamIdleMs > 0);
  assert.ok(CHAT_REQUEST_TIMEOUTS.totalAttemptMs > CHAT_REQUEST_TIMEOUTS.responseHeadersMs);
  assert.equal(getResponseHeadersTimeout(), CHAT_REQUEST_TIMEOUTS.responseHeadersMs);
  assert.match(getChatTimeoutMessage('stream-idle'), /stalled/i);
});
