import assert from 'node:assert/strict';
import test from 'node:test';
import { createServerAuthRequest } from './authTransport.js';

test('server authentication never sends unrelated browser cookies', () => {
  const options = createServerAuthRequest('session', {}, 'signed-token');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.headers.Authorization, 'Bearer signed-token');
  assert.deepEqual(JSON.parse(options.body), { action: 'session' });
});
