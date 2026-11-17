import test from 'node:test';
import assert from 'node:assert/strict';
import { getVoiceSession } from './voiceAgent.js';

const ok = () => Response.json({ conversationToken: 'scoped-voice-token' });
test('voice waits for restored authentication before choosing the account', async () => {
  let user = null;
  const auth = { currentUser: null, async authStateReady() { user = { uid: 'a' }; this.currentUser = { uid: 'a', getIdToken: async () => 'firebase-token' }; } };
  const result = await getVoiceSession(undefined, { getAuth: async () => auth, readUser: () => user, fetchImpl: async () => ok() });
  assert.equal(result.conversationToken, 'scoped-voice-token');
});
test('missing credentials request renewal without calling the voice provider', async () => {
  await assert.rejects(getVoiceSession(undefined, { getAuth: async () => null, readUser: () => ({ uid: 'a' }), readToken: () => null, fetchImpl: () => assert.fail('must not request a session') }), { code: 'voice/sign-in-required' });
});
test('rejected Firebase credentials are refreshed once before retrying', async () => {
  const refreshes = []; let requests = 0;
  const auth = { authStateReady: async () => {}, currentUser: { uid: 'a', getIdToken: async force => { refreshes.push(force); return 'firebase-token'; } } };
  await getVoiceSession(undefined, { getAuth: async () => auth, readUser: () => ({ uid: 'a' }), fetchImpl: async () => ++requests === 1 ? new Response('{}', { status: 401 }) : ok() });
  assert.deepEqual(refreshes, [false, true]); assert.equal(requests, 2);
});
test('a rejected server credential offers renewal instead of retrying forever', async () => {
  let requests = 0;
  await assert.rejects(getVoiceSession(undefined, { getAuth: async () => null, readUser: () => ({ uid: 'a' }), readToken: () => 'server-token', fetchImpl: async () => { requests++; return new Response('{}', { status: 401 }); } }), { code: 'voice/sign-in-required' });
  assert.equal(requests, 1);
});
test('account changes discard an in-flight conversation token', async () => {
  let user = { uid: 'a' };
  await assert.rejects(getVoiceSession(undefined, { getAuth: async () => null, readUser: () => user, readToken: () => 'server-token', fetchImpl: async () => { user = { uid: 'b' }; return ok(); } }), { code: 'voice/sign-in-required' });
});
test('malformed success responses cannot start a silent voice session', async () => {
  await assert.rejects(getVoiceSession(undefined, { getAuth: async () => null, readUser: () => ({ uid: 'a' }), readToken: () => 'server-token', fetchImpl: async () => Response.json({}) }), /Could not start voice/);
});
