import test from 'node:test';
import assert from 'node:assert/strict';
import { guardRequest } from './_requestSecurity.js';

test('blocks browser requests from untrusted origins', () => {
  const response = guardRequest(new Request('https://www.itsmira.cloud/api/chat', {
    headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' },
  }), { key: `origin-${Date.now()}` });
  assert.equal(response?.status, 403);
});

test('rate limits repeated expensive requests', () => {
  const key = `rate-${Date.now()}`;
  const request = new Request('https://www.itsmira.cloud/api/chat');
  assert.equal(guardRequest(request, { limit: 1, key }), null);
  assert.equal(guardRequest(request, { limit: 1, key })?.status, 429);
});
