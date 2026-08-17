import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_REQUEST_TIMEOUTS,
  getChatTimeoutMessage,
  getChatRetryDelayMs,
  getResponseHeadersTimeout,
  isChatTimeoutError,
  shouldRetryChatRequest,
} from './chatRequestPolicy.js';

test('uses bounded phase-aware timeouts instead of an unbounded response wait', () => {
  assert.ok(CHAT_REQUEST_TIMEOUTS.responseHeadersMs > 0);
  assert.ok(CHAT_REQUEST_TIMEOUTS.streamIdleMs > 0);
  assert.ok(CHAT_REQUEST_TIMEOUTS.totalAttemptMs > CHAT_REQUEST_TIMEOUTS.responseHeadersMs);
  assert.equal(getResponseHeadersTimeout(), CHAT_REQUEST_TIMEOUTS.responseHeadersMs);
  assert.match(getChatTimeoutMessage('stream-idle'), /stalled/i);
});

test('retries only transient chat failures and never retries user cancellation', () => {
  assert.equal(shouldRetryChatRequest({ status: 503, message: 'busy' }, 1, 2), true);
  assert.equal(shouldRetryChatRequest({ name: 'ChatTimeoutError' }, 1, 2), true);
  assert.equal(shouldRetryChatRequest({ status: 400, message: 'invalid' }, 1, 2), false);
  assert.equal(shouldRetryChatRequest({ name: 'AbortError' }, 1, 2), false);
  assert.equal(shouldRetryChatRequest({ status: 503 }, 2, 2), false);
  assert.equal(getChatRetryDelayMs(1), 350);
});

test('recognizes browser and server model-start timeouts', () => {
  assert.equal(isChatTimeoutError({ name: 'ChatTimeoutError' }), true);
  assert.equal(isChatTimeoutError(new Error('The model is busy and did not begin responding in time.')), true);
  assert.equal(isChatTimeoutError(new Error('A normal request failed.')), false);
});
