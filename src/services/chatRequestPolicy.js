export const CHAT_REQUEST_TIMEOUTS = Object.freeze({
  responseHeadersMs: 30000,
  streamIdleMs: 15000,
  totalAttemptMs: 90000,
});

export function getResponseHeadersTimeout() {
  return CHAT_REQUEST_TIMEOUTS.responseHeadersMs;
}

export function getChatTimeoutMessage(kind = '') {
  if (kind === 'response-headers') {
    return 'The model did not start responding in time.';
  }
  if (kind === 'stream-idle') {
    return 'The model response stalled before it completed.';
  }
  return 'The model took too long to complete the response.';
}

export function isChatTimeoutError(error) {
  if (error?.name === 'ChatTimeoutError') return true;
  return /(?:did not (?:start|begin) responding|model_start_timeout|response stalled|took too long|model is busy)/i
    .test(String(error?.message || ''));
}

const RETRYABLE_CHAT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function shouldRetryChatRequest(error, attemptNumber = 1, maxAttempts = 2) {
  if (attemptNumber >= maxAttempts || error?.name === 'AbortError') return false;
  // The upstream host is confirmed unreachable; retrying into a dead backend
  // only delays the inevitable. Surface it immediately.
  if (error?.code === 'model_unreachable') return false;
  if (isChatTimeoutError(error)) return true;
  if (RETRYABLE_CHAT_STATUS.has(Number(error?.status))) return true;
  return /(?:failed to fetch|network|connection|socket|temporar|overload|empty response|model.*unavailable)/i
    .test(String(error?.message || ''));
}

export function getChatRetryDelayMs(attemptNumber = 1) {
  return Math.min(1500, 350 * Math.max(1, Number(attemptNumber) || 1));
}
