import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REMEMBERED_USER_KEY,
  SERVER_SESSION_KEY,
  clearRememberedSession,
  discardServerToken,
  readRememberedUser,
  saveServerSession,
} from './authSessionStore.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test('remembered identity survives an invalidated server token', () => {
  const storage = memoryStorage();
  const user = { uid: 'user-1', email: 'person@example.com', displayName: 'Person' };
  saveServerSession({ token: 'payload.signature', user }, storage);

  discardServerToken(storage);

  assert.equal(storage.getItem(SERVER_SESSION_KEY), null);
  assert.equal(readRememberedUser(storage)?.uid, 'user-1');
  assert.ok(storage.getItem(REMEMBERED_USER_KEY));
});

test('remembered identity is removed only by explicit session clearing', () => {
  const storage = memoryStorage();
  saveServerSession({
    token: 'payload.signature',
    user: { uid: 'user-2', email: 'person@example.com' },
  }, storage);

  clearRememberedSession(storage);

  assert.equal(readRememberedUser(storage), null);
  assert.equal(storage.getItem(SERVER_SESSION_KEY), null);
});

test('legacy cached server users are promoted to durable remembered users', () => {
  const storage = memoryStorage();
  storage.setItem('mira_auth_user', JSON.stringify({ uid: 'legacy-user', email: 'legacy@example.com' }));

  assert.equal(readRememberedUser(storage)?.uid, 'legacy-user');
  assert.ok(storage.getItem(REMEMBERED_USER_KEY));
});
