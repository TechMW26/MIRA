import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { POST } from './auth.js';

const SECRET = 'test-auth-secret-that-is-longer-than-thirty-two-characters';

function authRequest(body, { token = '', ip = randomUUID() } = {}) {
  return new Request('https://www.itsmira.cloud/api/auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.itsmira.cloud',
      'X-Real-IP': ip,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function bodyTokenAuthRequest(body, token, { ip = randomUUID() } = {}) {
  return new Request('https://www.itsmira.cloud/api/auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.itsmira.cloud',
      'X-Real-IP': ip,
    },
    body: JSON.stringify({ ...body, sessionToken: token }),
  });
}

test('auth fails closed when its session secret is missing', async () => {
  const originalSecret = process.env.MIRA_AUTH_SECRET;
  delete process.env.MIRA_AUTH_SECRET;
  try {
    const response = await POST(authRequest({ action: 'session' }));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /not configured/i);
  } finally {
    if (originalSecret === undefined) delete process.env.MIRA_AUTH_SECRET;
    else process.env.MIRA_AUTH_SECRET = originalSecret;
  }
});

test('auth verifies and migrates a legacy account without exposing its password hash', async () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.MIRA_AUTH_SECRET;
  process.env.MIRA_AUTH_SECRET = SECRET;
  const password = 'correct horse battery staple';
  const legacyHash = createHash('sha256').update(`${password}mira_salt_2024`).digest('hex');
  let rootPatch = null;
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/userEmailIndex/')) return Response.json(null);
    if (target.endsWith('/users.json')) {
      return Response.json({
        existingUser: {
          email: 'person@example.com',
          displayName: 'Existing User',
          password: legacyHash,
        },
      });
    }
    if (target.endsWith('/.json') && options.method === 'PATCH') {
      rootPatch = JSON.parse(options.body);
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected auth storage request: ${target}`);
  };

  try {
    const response = await POST(authRequest({
      action: 'login',
      email: 'Person@Example.com',
      password,
    }));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.user.uid, 'existingUser');
    assert.equal(result.user.email, 'person@example.com');
    assert.equal(result.user.password, undefined);
    assert.match(result.token, /^[^.]+\.[^.]+$/);
    assert.ok(Object.keys(rootPatch).some((key) => key.startsWith('userEmailIndex/')));
    const migratedPassword = rootPatch['users/existingUser/password'];
    assert.match(migratedPassword, /^pbkdf2\$210000\$/);
    assert.notEqual(migratedPassword, password);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.MIRA_AUTH_SECRET;
    else process.env.MIRA_AUTH_SECRET = originalSecret;
  }
});

test('auth rejects a wrong password with a generic error', async () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.MIRA_AUTH_SECRET;
  process.env.MIRA_AUTH_SECRET = SECRET;
  globalThis.fetch = async (url) => {
    if (String(url).includes('/userEmailIndex/')) return Response.json('existingUser');
    if (String(url).includes('/users/existingUser.json')) {
      return Response.json({
        email: 'person@example.com',
        password: createHash('sha256').update('differentmira_salt_2024').digest('hex'),
      });
    }
    throw new Error(`Unexpected auth storage request: ${url}`);
  };
  try {
    const response = await POST(authRequest({
      action: 'login',
      email: 'person@example.com',
      password: 'wrong password',
    }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: 'Invalid email or password.',
      code: 'auth/invalid-credential',
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.MIRA_AUTH_SECRET;
    else process.env.MIRA_AUTH_SECRET = originalSecret;
  }
});

test('auth identifies stale session credentials as renewal failures', async () => {
  const originalSecret = process.env.MIRA_AUTH_SECRET;
  process.env.MIRA_AUTH_SECRET = SECRET;
  try {
    const response = await POST(bodyTokenAuthRequest(
      { action: 'session' },
      'stale.invalid',
    ));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: 'The saved server credential needs to be renewed.',
      code: 'auth/session-renewal-required',
    });
  } finally {
    if (originalSecret === undefined) delete process.env.MIRA_AUTH_SECRET;
    else process.env.MIRA_AUTH_SECRET = originalSecret;
  }
});

test('auth restores a signed server session and refreshes the public profile', async () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.MIRA_AUTH_SECRET;
  process.env.MIRA_AUTH_SECRET = SECRET;
  const storedPassword = createHash('sha256').update('passphrase123mira_salt_2024').digest('hex');
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    if (target.includes('/userEmailIndex/')) return Response.json('sessionUser');
    if (target.endsWith('/users/sessionUser.json')) {
      return Response.json({ email: 'session@example.com', displayName: 'Fresh Name', password: storedPassword });
    }
    if (target.endsWith('/.json') && options.method === 'PATCH') return Response.json({ ok: true });
    throw new Error(`Unexpected auth storage request: ${target}`);
  };
  try {
    const loginResponse = await POST(authRequest({
      action: 'login',
      email: 'session@example.com',
      password: 'passphrase123',
    }));
    const login = await loginResponse.json();
    const sessionResponse = await POST(bodyTokenAuthRequest(
      { action: 'session' },
      login.token,
    ));
    assert.equal(sessionResponse.status, 200);
    const session = await sessionResponse.json();
    assert.deepEqual(session.user, {
      uid: 'sessionUser',
      email: 'session@example.com',
      displayName: 'Fresh Name',
      photoURL: '',
    });
    assert.match(session.token, /^[^.]+\.[^.]+$/);
    const refreshedPayload = JSON.parse(Buffer.from(session.token.split('.')[0], 'base64url').toString('utf8'));
    assert.ok(refreshedPayload.expiresAt - refreshedPayload.issuedAt >= 9 * 365 * 24 * 60 * 60 * 1000);
    const secondSessionResponse = await POST(authRequest(
      { action: 'session' },
      { token: session.token },
    ));
    assert.equal(secondSessionResponse.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalSecret === undefined) delete process.env.MIRA_AUTH_SECRET;
    else process.env.MIRA_AUTH_SECRET = originalSecret;
  }
});
