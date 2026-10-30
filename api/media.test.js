import test from 'node:test';
import assert from 'node:assert/strict';
import { signMediaPath, verifyMediaPath } from './media.js';

test('media deletion tokens are bound to one exact generated path', () => {
  const previous = process.env.MIRA_MEDIA_SIGNING_SECRET;
  process.env.MIRA_MEDIA_SIGNING_SECRET = 'test-media-secret';
  try {
    const pathname = 'generated/user/chat/123-message.jpg';
    const token = signMediaPath(pathname);
    assert.ok(token);
    assert.equal(verifyMediaPath(pathname, token), true);
    assert.equal(verifyMediaPath('generated/other/chat/123-message.jpg', token), false);
  } finally {
    if (previous === undefined) delete process.env.MIRA_MEDIA_SIGNING_SECRET;
    else process.env.MIRA_MEDIA_SIGNING_SECRET = previous;
  }
});
