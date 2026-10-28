import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rememberAuthUser } from './authSessionStore.js';
import { markWorkplaceChat, protectWorkplaceMessage, openWorkplaceMessages, clearWorkplaceMemory, PRIVATE_WORKPLACE_PLACEHOLDER } from './workplacePrivacy.js';

function identity(uid = 'owner') {
  globalThis.localStorage = { values: new Map(), getItem(key) { return this.values.get(key) || null; }, setItem(key, value) { this.values.set(key, value); } };
  rememberAuthUser({ uid }); clearWorkplaceMemory();
}
test('ordinary chat persistence stays unchanged', async () => {
  identity(); const message = { content: 'Ordinary answer', role: 'assistant' };
  assert.deepEqual(await protectWorkplaceMessage('ordinary', message, async () => { throw Error('must not call'); }), message);
});
test('private partial chunks and final messages never enter legacy storage as plaintext', async () => {
  identity(); markWorkplaceChat('private-chat');
  const partial = await protectWorkplaceMessage('private-chat', { content: 'confidential task', thinkingContent: 'private reasoning', isStreaming: true }, async () => { throw Error('must not call'); });
  assert.equal(partial.content, PRIVATE_WORKPLACE_PLACEHOLDER); assert.equal(partial.thinkingContent, undefined); assert.equal(partial.talioSealed, null);
  let sent;
  const final = await protectWorkplaceMessage('private-chat', { content: 'confidential task', thinkingContent: 'private reasoning', isStreaming: false }, async (...args) => { sent = args; return { sealed: 'encrypted-packet' }; }, 'message');
  assert.equal(final.talioSealed, 'encrypted-packet'); assert.ok(!JSON.stringify(final).includes('confidential'));
  assert.equal(sent[1].conversationId, 'private-chat'); assert.equal(sent[1].messageId, 'message');
  await assert.rejects(protectWorkplaceMessage('private-chat', { content: 'secret' }, async () => ({}), 'message'), /not synchronized/);
});
test('account changes and unavailable/revoked connections never expose a decrypted result', async () => {
  identity(); markWorkplaceChat('account-chat');
  const messages = [{ id: 'message', role: 'assistant', privateTalio: true, talioSealed: 'encrypted-packet', content: PRIVATE_WORKPLACE_PLACEHOLDER }];
  const switched = await openWorkplaceMessages('account-chat', messages, async () => { rememberAuthUser({ uid: 'other' }); return { payload: { content: 'private task' } }; });
  assert.equal(switched[0].content, PRIVATE_WORKPLACE_PLACEHOLDER);
  const revoked = await openWorkplaceMessages('account-chat', messages, async () => { throw Error('revoked'); });
  assert.equal(revoked[0].content, PRIVATE_WORKPLACE_PLACEHOLDER);
});
test('authorized private messages retain identity binding and ordinary cached records remain encrypted', async () => {
  identity();
  const message = { id: 'private-message', role: 'assistant', privateTalio: true, talioSealed: 'ciphertext', content: PRIVATE_WORKPLACE_PLACEHOLDER };
  let request;
  const opened = await openWorkplaceMessages('private-conversation', [message], async (...args) => { request = args; return { payload: { content: 'verified private task' } }; });
  assert.equal(opened[0].content, 'verified private task'); assert.equal(message.content, PRIVATE_WORKPLACE_PLACEHOLDER);
  assert.deepEqual(request[1], { sealed: 'ciphertext', conversationId: 'private-conversation', messageId: 'private-message' });
});
test('actual chat/voice dispatch gates private tools and avoids automatic memory/cache/public-search copies', () => {
  const source = fs.readFileSync(new URL('../hooks/useChat.js', import.meta.url), 'utf8');
  for (const name of ['TALIO_CONTEXT', 'TALIO_ACTION', 'TALIO_ACTIVITY', 'TALIO_RECEIPT']) assert.ok(source.includes('TOOL_NAMES.' + name));
  assert.match(source, /allowWorkplace: !isActingForAnotherUser/);
  assert.match(source, /if \(isWorkplaceChat\(convId\)\) return;/);
  assert.match(source, /const autoSearchEligible =\s*!isWorkplaceChat\(convId\)/);
  assert.match(source, /cacheKey\s*&& !isWorkplaceChat\(convId\)/);
  assert.match(source, /isWorkplaceChat\(convId\) \? 'Your private Talio reply/);
});
test('private history opens in bounded batches rather than one authorization request per message', async () => {
  identity();
  const messages = Array.from({ length: 25 }, (_, index) => ({ id: 'message-' + index, privateTalio: true, talioSealed: 'cipher-' + index, content: PRIVATE_WORKPLACE_PLACEHOLDER }));
  const calls = [];
  const opened = await openWorkplaceMessages('batch-chat', messages, async (operation, args) => {
    calls.push(operation);
    return operation === 'open-message' ? { payload: { content: 'Opened' } } : { messages: args.messages.map(message => ({ messageId: message.messageId, payload: { content: 'Opened' } })) };
  });
  assert.equal(calls.length, 3); assert.ok(opened.every(message => message.content === 'Opened'));
  await openWorkplaceMessages('batch-chat', messages, async () => { throw Error('cached messages should not request again'); });
});
