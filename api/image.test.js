import assert from 'node:assert/strict';
import test from 'node:test';
import { isPrivateHostname } from './image.js';

test('image proxy rejects private IPv4, IPv6, local names, and mapped addresses', () => {
  for (const hostname of [
    'localhost',
    'service.internal',
    '127.0.0.1',
    '10.2.3.4',
    '169.254.169.254',
    '172.16.4.5',
    '192.168.1.2',
    '::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ]) assert.equal(isPrivateHostname(hostname), true, hostname);
  assert.equal(isPrivateHostname('8.8.8.8'), false);
  assert.equal(isPrivateHostname('images.example.com'), false);
});
