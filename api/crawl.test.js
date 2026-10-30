import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicUrl } from './crawl.js';

test('crawler accepts public web URLs and rejects local-network targets', () => {
  assert.equal(validatePublicUrl('https://example.com/about'), 'https://example.com/about');
  assert.equal(validatePublicUrl('http://localhost:3000/private'), null);
  assert.equal(validatePublicUrl('http://127.0.0.1/admin'), null);
  assert.equal(validatePublicUrl('http://192.168.1.20/'), null);
  assert.equal(validatePublicUrl('file:///etc/passwd'), null);
});
