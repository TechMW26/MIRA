export function createServerAuthRequest(action, payload = {}, token = '', signal) {
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
    // Authentication uses the explicit Bearer token. Site cookies are neither
    // needed nor trusted here, and omitting them prevents oversized accumulated
    // cookie headers from being rejected by the hosting edge with HTTP 494.
    credentials: 'omit',
    signal,
  };
}
