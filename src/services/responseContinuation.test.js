import test from 'node:test';
import assert from 'node:assert/strict';
import { appendContinuation, completeChatResponse } from './responseContinuation.js';
import { readChatResponse } from './api.js';

test('removes exact repeated paragraph overlap when resuming', () => {
  const repeated='Prepare the workshop materials and confirm attendance.';
  assert.equal(appendContinuation('First: '+repeated,repeated+' Then begin.'),'First: '+repeated+' Then begin.');
});

test('detects length limits and preserves the incomplete formatted answer', async () => {
  const r = new Response('data: {"choices":[{"delta":{"content":"## Plan\\n\\n1. Start"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n');
  const parsed = await readChatResponse(r);
  assert.equal(parsed.answer, '## Plan\n\n1. Start');
  assert.equal(parsed.incomplete, true);
});

test('detects a dropped connection without a terminal marker', async () => {
  const parsed = await readChatResponse(new Response('data: {"choices":[{"delta":{"content":"Partial answer"}}]}\n\n'));
  assert.equal(parsed.incomplete, true);
  assert.equal(parsed.answer, 'Partial answer');
});

test('recognizes complete NDJSON and SSE responses', async () => {
  for (const wire of [
    '{"message":{"content":"Complete"},"done":true,"done_reason":"stop"}\n',
    'data: {"choices":[{"delta":{"content":"Complete"},"finish_reason":"stop"}]}\n\n',
  ]) assert.equal((await readChatResponse(new Response(wire))).incomplete, false);
});

test('continuation retains previous text and sends context without tools', async () => {
  const requests = [];
  const visible = [];
  const result = await completeChatResponse({messages:[{role:'user',content:'Plan a workshop'}],onChunk:c=>visible.push(c.answerFull)}, async options => {
    requests.push(options);
    const answer = requests.length === 1 ? '## Plan\n\n1. Prepare' : ' the room.\n2. Welcome attendees.';
    options.onChunk({answerFull:answer});
    return {answer,incomplete:requests.length===1};
  });
  assert.equal(result.answer,'## Plan\n\n1. Prepare the room.\n2. Welcome attendees.');
  assert.equal(requests[1].messages[1].content,'## Plan\n\n1. Prepare');
  assert.deepEqual(requests[1].tools,[]);
  assert.equal(visible.at(-1),result.answer);
});

test('keeps partial work and explicitly reports failed continuation', async () => {
  let calls=0;
  const result=await completeChatResponse({messages:[]},async()=>{
    if (++calls===1) return {answer:'Useful partial content',incomplete:true};
    throw Error('Service unavailable');
  });
  assert.match(result.answer,/Useful partial content/);
  assert.match(result.answer,/interrupted before completion/);
});

test('user cancellation never triggers another continuation', async () => {
  let calls=0;
  await assert.rejects(completeChatResponse({messages:[]},async()=>{
    calls++; throw new DOMException('Stopped','AbortError');
  }),{name:'AbortError'});
  assert.equal(calls,1);
});
