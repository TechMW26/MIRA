import test from 'node:test';
import assert from 'node:assert/strict';
import { extractChatText, toolCallsToControl } from './api.js';
import { extractToolCall, stripToolControl } from './toolControl.js';

test('converts native tool calls into hidden executable control messages', () => {
  const control = toolCallsToControl([{
    function: { name: 'web.search', arguments: { query: 'latest Bitcoin price' } },
  }]);
  assert.deepEqual(extractToolCall(control), {
    name: 'web.search',
    arguments: { query: 'latest Bitcoin price' },
    raw: control,
  });
  assert.equal(stripToolControl(control), '');
});

test('never renders native tool-selection labels or unsupported tools', () => {
  assert.equal(extractChatText({
    message: { tool_calls: [{ function: { name: 'container.exec', arguments: { cmd: ['echo', 'hello'] } } }] },
  }), '');
  assert.equal(extractChatText({
    message: { tool_calls: [{ function: { name: 'web.search', arguments: '{"query":"Mira"}' } }] },
  }).includes('Using tools'), false);
});
