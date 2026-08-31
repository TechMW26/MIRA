export const CHAT_REQUEST_TIMEOUTS = Object.freeze({
  responseHeadersMs: 65000,
  streamIdleMs: 45000,
  totalAttemptMs: 240000,
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
  return /(?:did not (?:start|begin|accept)|model_start_timeout|upstream_start_timeout|response stalled|took too long|model is busy|model is still starting)/i
    .test(String(error?.message || ''));
}

const RETRYABLE_CHAT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export function shouldRetryChatRequest(error, attemptNumber = 1, maxAttempts = 2) {
  if (attemptNumber >= maxAttempts || error?.name === 'AbortError') return false;
  if (isChatTimeoutError(error)) return true;
  if (RETRYABLE_CHAT_STATUS.has(Number(error?.status))) return true;
  return /(?:failed to fetch|network|connection|socket|temporar|overload|empty response|model.*unavailable)/i
    .test(String(error?.message || ''));
}

export function shouldRetryChatRequestAfterHealth(error, health) {
  if (!health || typeof health !== 'object') return true;
  const coldModel = health.ready === true
    && health.registryReachable === true
    && Number(health.completionModelCount || 0) > 0
    && Number(health.loadedModelCount || 0) === 0;
  if (!coldModel) return true;
  return !(isChatTimeoutError(error) || RETRYABLE_CHAT_STATUS.has(Number(error?.status)));
}

export function getChatRetryDelayMs(attemptNumber = 1) {
  return Math.min(1500, 350 * Math.max(1, Number(attemptNumber) || 1));
}
