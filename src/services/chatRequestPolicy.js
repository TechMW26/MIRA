export function getRetryModel(model = '', attempt = 1) {
  const normalized = String(model || 'auto').trim().toLowerCase();
  if (attempt <= 1 || normalized === 'locked' || normalized === 'mira-locked') return model;
  // Standard Mira is hosted exclusively on our VPS. Retries must stay on the
  // same deployment and must never cross over to Mira Pro/Salad.
  if (normalized === 'mira' || normalized === 'mira-v4' || normalized === 'mira-v4:latest') {
    return model;
  }
  if (normalized === 'mira-lite' || normalized === 'lite' || normalized === 'auto') {
    return attempt === 2 ? 'mira' : 'mira-pro';
  }
  if (normalized === 'mira-pro' || normalized === 'pro') {
    return attempt === 2 ? 'mira' : 'mira-lite';
  }
  return model;
}

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
