export const CHAT_REQUEST_TIMEOUTS = Object.freeze({
  responseHeadersMs: 20000,
  miraV4ResponseHeadersMs: 65000,
  streamIdleMs: 30000,
  totalAttemptMs: 120000,
});

export function getResponseHeadersTimeout(model = '') {
  const normalized = String(model || '').trim().toLowerCase();
  return normalized === 'mira'
    || normalized === 'mira-v4'
    || normalized === 'mira-v4:latest'
    ? CHAT_REQUEST_TIMEOUTS.miraV4ResponseHeadersMs
    : CHAT_REQUEST_TIMEOUTS.responseHeadersMs;
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
