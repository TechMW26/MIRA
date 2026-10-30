import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export const PENDING_COOKIE = 'mira_talio_pending';
export const LINK_COOKIE = 'mira_talio_link';
function key() {
  const secret = process.env.MIRA_LINK_COOKIE_SECRET || process.env.MIRA_AUTH_SECRET || '';
  if (secret.length < 32) throw Object.assign(new Error('Talio linking is not configured on this server.'), { status: 503 });
  return createHash('sha256').update('mira-talio-link-v1:' + secret).digest();
}
export function sealLink(value, purpose) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}
export function readLink(request, name, uid, now = Date.now()) {
  try {
    const raw = (request.headers.get('cookie') || '').split(';').map(v => v.trim()).find(v => v.startsWith(name + '='))?.slice(name.length + 1);
    if (!raw || raw.length > 3500) return null;
    const value = unsealLink(raw, name);
    return value.uid === uid && Number.isFinite(value.expiresAt) && value.expiresAt > now ? value : null;
  } catch { return null; }
}
export function unsealLink(raw, purpose) {
  const data = Buffer.from(raw, 'base64url'), cipher = createDecipheriv('aes-256-gcm', key(), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(purpose)); cipher.setAuthTag(data.subarray(-16));
  return JSON.parse(Buffer.concat([cipher.update(data.subarray(12, -16)), cipher.final()]).toString());
}
export const linkFingerprint = token => createHash('sha256').update(token).digest('hex');
export function linkCookie(name, value, maxAge) {
  return `${name}=${value}; Path=/api/talio-link; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
export async function talioServerRequest(path, body, token) {
  const base = process.env.TALIO_LINK_BASE_URL || 'https://app.talio.in';
  const url = new URL(base);
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error('A secure Talio server URL is required.');
  const response = await fetch(new URL('/api/mira/link/' + path, url.origin), { method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
}
export function pairingVerifier() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}
