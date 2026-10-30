import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { POST } from '../../api/talio-link.js';
import { sealLink, readLink, linkCookie, LINK_COOKIE, PENDING_COOKIE } from '../../api/_talioLink.js';

const secret = 'server-auth-test-secret-of-at-least-32-characters';
function token(uid = 'owner') {
  const data = Buffer.from(JSON.stringify({ uid, expiresAt: Date.now() + 60000 })).toString('base64url');
  return data + '.' + createHmac('sha256', secret).update(data).digest('base64url');
}
function request(body, cookie = '', uid = 'owner') {
  return new Request('https://www.itsmira.cloud/api/talio-link', { method: 'POST', headers: { Origin: 'https://www.itsmira.cloud', 'Content-Type': 'application/json', 'x-real-ip': randomUUID(), Cookie: cookie }, body: JSON.stringify({ ...body, sessionToken: token(uid) }) });
}
async function fixture(fn) {
  const originalFetch = globalThis.fetch, originalEnv = { ...process.env };
  process.env.MIRA_AUTH_SECRET = secret; delete process.env.MIRA_LINK_COOKIE_SECRET; delete process.env.VITE_FIREBASE_API_KEY;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.includes('.json')) return Response.json({ email: 'user@example.test', displayName: 'MIRA User' });
    calls.push({ url: target, ...options, body: JSON.parse(options.body) });
    if (target.endsWith('/device') && JSON.parse(options.body).operation === 'start') return Response.json({ device_code: 'd'.repeat(43), user_code: 'ABCDE-12345', interval: 5, verification_uri_complete: 'https://app.talio.in/dashboard/mira/connect?user_code=ABCDE-12345' });
    if (target.endsWith('/device')) return Response.json({ access_token: 't'.repeat(43), expires_at: Date.now() + 100000, profile: { name: 'Talio User', company: 'Talio Org' }, scopes: ['workplace:read'] });
    return Response.json({ success: true, linked: true, account: { name: 'Talio User' } });
  };
  try { await fn(calls); } finally { globalThis.fetch = originalFetch; process.env = originalEnv; }
}
test('sealed integration cookies are purpose-bound, UID-bound, tamper-resistant and expiring', async () => fixture(async () => {
  const value = sealLink({ uid: 'owner', token: 'private-token', expiresAt: Date.now() + 10000 }, LINK_COOKIE);
  const req = new Request('https://www.itsmira.cloud/api/talio-link', { headers: { Cookie: `${LINK_COOKIE}=${value}` } });
  assert.equal(readLink(req, LINK_COOKIE, 'owner').token, 'private-token');
  assert.equal(readLink(req, LINK_COOKIE, 'other'), null);
  assert.equal(readLink(req, LINK_COOKIE, 'owner', Date.now() + 20000), null);
  assert.equal(readLink(new Request(req.url, { headers: { Cookie: `${PENDING_COOKIE}=${value}` } }), PENDING_COOKIE, 'owner'), null);
  assert.equal(readLink(new Request(req.url, { headers: { Cookie: `${LINK_COOKIE}=x${value.slice(1)}` } }), LINK_COOKIE, 'owner'), null);
  assert.ok(!value.includes('private-token'));
}));
test('begin exposes only a human code and approval URL, never device credentials', async () => fixture(async calls => {
  process.env.NODE_ENV = 'production';
  const response = await POST(request({ operation: 'begin', allowActions: false }));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.userCode, 'ABCDE-12345');
  assert.equal(data.device_code, undefined);
  assert.ok(!JSON.stringify(data).includes('d'.repeat(43)));
  assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.match(response.headers.get('set-cookie'), /Secure/);
  assert.equal(calls[0].body.allowActions, false);
  assert.equal(calls[0].body.sessionToken, undefined);
  assert.equal(calls[0].body.challenge.length, 43);
}));
test('a different signed-in account cannot poll another account’s pending approval', async () => fixture(async calls => {
  const begin = await POST(request({ operation: 'begin', allowActions: false }));
  const response = await POST(request({ operation: 'poll' }, begin.headers.get('set-cookie'), 'other'));
  assert.equal(response.status, 400);
  assert.equal(calls.length, 1);
}));
test('approval stores a sealed grant and hides access credentials from the browser response', async () => fixture(async calls => {
  const begin = await POST(request({ operation: 'begin', allowActions: true }));
  const poll = await POST(request({ operation: 'poll' }, begin.headers.get('set-cookie')));
  assert.equal(poll.status, 200);
  const body = await poll.json();
  assert.equal(body.linked, true);
  assert.equal(body.access_token, undefined);
  const cookie = poll.headers.get('set-cookie');
  assert.ok(!cookie.includes('t'.repeat(43)));
  const result = await POST(request({ operation: 'context', query: 'my tasks', tenant: 'attacker', token: 'attacker' }, cookie));
  assert.equal(result.status, 200);
  assert.equal(calls.at(-1).headers.Authorization, 'Bearer ' + 't'.repeat(43));
  assert.deepEqual(calls.at(-1).body, { operation: 'context', query: 'my tasks' });
  const other = await POST(request({ operation: 'status' }, cookie, 'other'));
  assert.deepEqual(await other.json(), { linked: false });
}));
test('forged identity and cross-site requests never reach Talio', async () => fixture(async calls => {
  const forged = new Request('https://www.itsmira.cloud/api/talio-link', { method: 'POST', body: JSON.stringify({ operation: 'begin', allowActions: true, uid: 'owner', email: 'owner@example.test', sessionToken: 'forged.invalid' }) });
  assert.equal((await POST(forged)).status, 401);
  const cross = new Request(forged.url, { method: 'POST', headers: { Origin: 'https://attacker.invalid', 'sec-fetch-site': 'cross-site' }, body: '{}' });
  assert.equal((await POST(cross)).status, 403);
  assert.equal(calls.length, 0);
}));
test('disconnect clears its cookie only after upstream revocation; no network action is retried', async () => fixture(async calls => {
  const cookie = linkCookie(LINK_COOKIE, sealLink({ uid: 'owner', token: 't'.repeat(43), expiresAt: Date.now() + 10000 }, LINK_COOKIE), 10);
  const response = await POST(request({ operation: 'disconnect' }, cookie));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.operation, 'disconnect');
}));
test('private history encryption is bound to the account, grant, conversation and message', async () => fixture(async () => {
  const cookie = linkCookie(LINK_COOKIE, sealLink({ uid: 'owner', token: 't'.repeat(43), expiresAt: Date.now() + 10000 }, LINK_COOKIE), 10);
  const response = await POST(request({ operation: 'protect-message', conversationId: 'chat-one', messageId: 'message-one', payload: { content: 'confidential-workplace-data' } }, cookie));
  assert.equal(response.status, 200);
  const { sealed } = await response.json();
  assert.ok(!sealed.includes('confidential'));
  const opened = await POST(request({ operation: 'open-message', conversationId: 'chat-one', messageId: 'message-one', sealed }, cookie));
  assert.deepEqual((await opened.json()).payload, { content: 'confidential-workplace-data' });
  const moved = await POST(request({ operation: 'open-message', conversationId: 'other-chat', messageId: 'message-one', sealed }, cookie));
  assert.equal(moved.status, 403);
  const otherGrant = linkCookie(LINK_COOKIE, sealLink({ uid: 'owner', token: 'z'.repeat(43), expiresAt: Date.now() + 10000 }, LINK_COOKIE), 10);
  assert.equal((await POST(request({ operation: 'open-message', conversationId: 'chat-one', messageId: 'message-one', sealed }, otherGrant))).status, 403);
}));
