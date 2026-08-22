import {
  createHmac,
  createHash,
  pbkdf2 as derivePassword,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { guardRequest } from './_requestSecurity.js';

const pbkdf2 = promisify(derivePassword);
const DATABASE_URL = String(
  process.env.VITE_FIREBASE_DATABASE_URL
  || 'https://mira-3ffa4-default-rtdb.asia-southeast1.firebasedatabase.app',
).replace(/\/+$/, '');
const PASSWORD_ITERATIONS = 210_000;
// Sessions are rolling: every successful restoration returns a freshly signed
// token. A long absolute window prevents desktop users from being signed out
// merely because they did not open MIRA for a week, while server validation
// still confirms that the account exists whenever the app resumes.
const SESSION_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 16 * 1024;

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

function publicUser(uid, profile = {}) {
  return {
    uid: String(uid || ''),
    email: String(profile.email || '').trim().toLowerCase(),
    displayName: String(profile.displayName || '').trim(),
    photoURL: String(profile.photoURL || '').trim(),
  };
}

function normalizedEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function emailIndexKey(email) {
  return createHash('sha256').update(normalizedEmail(email)).digest('hex');
}

function firebaseUrl(path = '') {
  const cleanPath = String(path || '').replace(/^\/+|\/+$/g, '');
  return `${DATABASE_URL}/${cleanPath ? `${cleanPath}.json` : '.json'}`;
}

async function firebaseRequest(path, options = {}) {
  const response = await fetch(firebaseUrl(path), {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Authentication storage returned HTTP ${response.status}.`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function findUser(email) {
  const normalized = normalizedEmail(email);
  const indexKey = emailIndexKey(normalized);
  const indexedUid = await firebaseRequest(`userEmailIndex/${indexKey}`);
  if (indexedUid) {
    const profile = await firebaseRequest(`users/${indexedUid}`);
    if (profile) return { uid: String(indexedUid), profile, indexKey };
  }

  // Accounts created by older MIRA releases predate the private email index.
  const users = await firebaseRequest('users');
  const match = Object.entries(users || {}).find(([, profile]) => (
    normalizedEmail(profile?.email) === normalized
  ));
  if (!match) return null;
  return { uid: match[0], profile: match[1], indexKey };
}

function safeHexEqual(left, right) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  const leftBytes = Buffer.from(left, 'hex');
  const rightBytes = Buffer.from(right, 'hex');
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function createPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const digest = await pbkdf2(password, salt, PASSWORD_ITERATIONS, 32, 'sha256');
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${digest.toString('hex')}`;
}

async function verifyPassword(password, stored = '') {
  const parts = String(stored).split('$');
  if (parts[0] === 'pbkdf2' && parts.length === 4) {
    const iterations = Math.max(100_000, Math.min(1_000_000, Number(parts[1]) || PASSWORD_ITERATIONS));
    const digest = await pbkdf2(password, parts[2], iterations, 32, 'sha256');
    return safeHexEqual(digest.toString('hex'), parts[3]);
  }

  // One-time migration path for accounts from the fixed-salt SHA-256 release.
  const legacy = createHash('sha256').update(`${password}mira_salt_2024`).digest('hex');
  return safeHexEqual(legacy, String(stored));
}

function authSecret() {
  const secret = String(process.env.MIRA_AUTH_SECRET || '').trim();
  return secret.length >= 32 ? secret : '';
}

function signSession(user) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({
    ...publicUser(user.uid, user),
    issuedAt: now,
    expiresAt: now + SESSION_LIFETIME_MS,
  })).toString('base64url');
  const signature = createHmac('sha256', authSecret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function verifySession(token) {
  const [payload, providedSignature, extra] = String(token || '').split('.');
  if (!payload || !providedSignature || extra) return null;
  const expectedSignature = createHmac('sha256', authSecret()).update(payload).digest('base64url');
  const left = Buffer.from(providedSignature);
  const right = Buffer.from(expectedSignature);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.uid || Number(session.expiresAt) <= Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function bearerToken(request) {
  const authorization = String(request.headers.get('authorization') || '');
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

async function login(request, body) {
  const email = normalizedEmail(body.email);
  const password = String(body.password || '');
  if (!email || !password) return json({ error: 'Email and password are required.' }, 400);

  const limited = guardRequest(request, {
    limit: 10,
    windowMs: 10 * 60 * 1000,
    key: `auth-login-${emailIndexKey(email)}`,
  });
  if (limited) return limited;

  const found = await findUser(email);
  if (!found || !await verifyPassword(password, found.profile?.password)) {
    return json({ error: 'Invalid email or password.', code: 'auth/invalid-credential' }, 401);
  }

  const updates = { [`userEmailIndex/${found.indexKey}`]: found.uid };
  if (!String(found.profile.password || '').startsWith('pbkdf2$')) {
    updates[`users/${found.uid}/password`] = await createPassword(password);
    updates[`users/${found.uid}/passwordMigratedAt`] = Date.now();
  }
  await firebaseRequest('', { method: 'PATCH', body: JSON.stringify(updates) });

  const user = publicUser(found.uid, found.profile);
  return json({ user, token: signSession(user) });
}

async function register(request, body) {
  const email = normalizedEmail(body.email);
  const password = String(body.password || '');
  const displayName = String(body.displayName || '').trim().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (password.length < 8) return json({ error: 'Password must be at least 8 characters.' }, 400);

  const limited = guardRequest(request, { limit: 5, windowMs: 60 * 60 * 1000, key: 'auth-register' });
  if (limited) return limited;
  if (await findUser(email)) {
    return json({ error: 'An account with this email already exists.', code: 'auth/email-already-in-use' }, 409);
  }

  const uid = randomBytes(16).toString('hex');
  const profile = {
    email,
    displayName,
    photoURL: '',
    password: await createPassword(password),
    createdAt: Date.now(),
  };
  await firebaseRequest('', {
    method: 'PATCH',
    body: JSON.stringify({
      [`users/${uid}`]: profile,
      [`userEmailIndex/${emailIndexKey(email)}`]: uid,
    }),
  });
  const user = publicUser(uid, profile);
  return json({ user, token: signSession(user) }, 201);
}

async function restoreSession(request) {
  const session = verifySession(bearerToken(request));
  if (!session) return json({ error: 'Your session is invalid or has expired.' }, 401);
  const profile = await firebaseRequest(`users/${session.uid}`);
  if (!profile) return json({ error: 'This account no longer exists.' }, 401);
  const user = publicUser(session.uid, profile);
  return json({ user, token: signSession(user) });
}

export async function POST(request) {
  const blocked = guardRequest(request, { limit: 40, windowMs: 60_000, key: 'auth' });
  if (blocked) return blocked;
  if (!authSecret()) return json({ error: 'Authentication service is not configured.' }, 503);
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return json({ error: 'Request body is too large.' }, 413);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'A valid JSON body is required.' }, 400);
  }

  try {
    if (body.action === 'login') return await login(request, body);
    if (body.action === 'register') return await register(request, body);
    if (body.action === 'session') return await restoreSession(request);
    return json({ error: 'Unsupported authentication action.' }, 400);
  } catch (error) {
    console.error('[MIRA:auth] request failed', { message: error?.message || 'Unknown error' });
    return json({ error: 'Authentication is temporarily unavailable. Please retry.' }, 503);
  }
}
