import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFirebaseRestUrl,
  fetchFirebaseSnapshot,
  writeFirebaseValue,
} from './firebaseRest.js';

test('builds a safe Firebase REST path', () => {
  assert.equal(
    buildFirebaseRestUrl('https://example.firebaseio.com/', 'projects/user id'),
    'https://example.firebaseio.com/projects/user%20id.json',
  );
});

test('writes Firebase values without browser credentials', async () => {
  let request;
  const result = await writeFirebaseValue(
    'https://example.firebaseio.com',
    'messages/conversation/message',
    { content: 'Hello' },
    {
      method: 'PATCH',
      fetchImpl: async (url, options) => {
        request = { url, options };
        return Response.json({ content: 'Hello' });
      },
    },
  );
  assert.equal(request.url, 'https://example.firebaseio.com/messages/conversation/message.json');
  assert.equal(request.options.method, 'PATCH');
  assert.equal(request.options.credentials, 'omit');
  assert.deepEqual(JSON.parse(request.options.body), { content: 'Hello' });
  assert.deepEqual(result, { content: 'Hello' });
});

test('loads a snapshot without sending browser credentials', async () => {
  let request;
  const snapshot = await fetchFirebaseSnapshot(
    'https://example.firebaseio.com',
    'projects/user',
    {
      signal: null,
      fetchImpl: async (url, options) => {
        request = { url, options };
        return {
          ok: true,
          json: async () => ({ first: { name: 'CANACT' } }),
        };
      },
    },
  );
  const children = [];
  snapshot.forEach((child) => children.push({ id: child.key, ...child.val() }));
  assert.equal(request.url, 'https://example.firebaseio.com/projects/user.json');
  assert.equal(request.options.credentials, 'omit');
  assert.deepEqual(children, [{ id: 'first', name: 'CANACT' }]);
});
