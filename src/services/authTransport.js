const MAX_SESSION_TOKEN_CHARS = 4096;

export function isValidServerSessionToken(token = '') {
  const value = String(token || '').trim();
  if (!value || value.length > MAX_SESSION_TOKEN_CHARS) return false;
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

export function createServerAuthRequest(action, payload = {}, token = '', signal) {
  const sessionToken = action === 'session' && isValidServerSessionToken(token)
    ? String(token).trim()
    : '';
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    // Keep the bounded session token in the JSON body. Vercel rejects any
    // individual request header above 16 KB before the function runs (HTTP
    // 494), so Authorization is the wrong recovery channel for a value read
    // from mutable browser storage.
    body: JSON.stringify({ action, ...payload, ...(sessionToken ? { sessionToken } : {}) }),
    credentials: 'omit',
    signal,
  };
}
