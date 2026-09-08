import assert from 'node:assert/strict';
import test from 'node:test';
import { createServerAuthRequest, isValidServerSessionToken } from './authTransport.js';

test('server authentication uses a bounded body token and never sends browser credentials', () => {
  const options = createServerAuthRequest('session', {}, 'signed.token');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(options.body), { action: 'session', sessionToken: 'signed.token' });
});

test('rejects malformed or oversized saved session values before they reach the network', () => {
  assert.equal(isValidServerSessionToken('signed.token'), true);
  assert.equal(isValidServerSessionToken('not-a-session'), false);
  assert.equal(isValidServerSessionToken(`${'a'.repeat(5000)}.token`), false);
  const options = createServerAuthRequest('session', {}, `${'a'.repeat(5000)}.token`);
  assert.deepEqual(JSON.parse(options.body), { action: 'session' });
});
