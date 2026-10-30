import { SERVER_SESSION_KEY, readRememberedUser } from './authSessionStore.js';

export async function talioRequest(operation, input = {}) {
  const uid = readRememberedUser()?.uid;
  const { auth } = typeof window === 'undefined' ? { auth: null } : await import('../config/firebase.js');
  if (auth) await auth.authStateReady();
  if (readRememberedUser()?.uid !== uid) throw new Error('The MIRA account changed. Please retry from your current account.');
  const token = auth?.currentUser ? await auth.currentUser.getIdToken() : localStorage.getItem(SERVER_SESSION_KEY);
  if (!uid || !token) throw new Error('Please sign into MIRA again to link Talio.');
  const response = await fetch('/api/talio-link', { method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...input, operation, sessionToken: token }), signal: AbortSignal.timeout(20000),
  });
  if (readRememberedUser()?.uid !== uid) throw new Error('The MIRA account changed; the workplace result was discarded.');
  const data = await response.json();
  const messages = { access_denied: 'Talio access was declined. No account was linked.', expired_token: 'The connection code expired. Please start a new connection.', invalid_grant: 'This connection expired or was revoked. Please link Talio again.', link_not_configured: 'Talio linking needs server configuration.', slow_down: 'Please wait before trying again.' };
  if (!response.ok) throw Object.assign(new Error(messages[data.error] || data.error || data.message || 'Talio request failed.'), { code: data.error, interval: data.interval, status: response.status });
  return data;
}
