import test from 'node:test';
import assert from 'node:assert/strict';
import { extractChatText, toolCallsToControl, sendChatMessage } from './api.js';
import { extractToolCall, stripToolControl } from './toolControl.js';

test('desktop task continuation retains phase context and completion metadata', async () => {
  const previousWindow = globalThis.window;
  const requests=[];
  globalThis.window={miraDesktop:{invokeTool:()=>{},requestAgentChat:async options=>{
    requests.push(options);
    return {ok:true,answer:requests.length===1?'## Plan\n1. Prepare':' the room.\n2. Welcome guests.',finishReason:requests.length===1?'length':'stop'};
  }}};
  try {
    const result=await sendChatMessage([{role:'user',content:'Plan an online workshop, no weekends.'}],()=>{},[],{desktopCoding:true,requestClass:'task',returnDetails:true,tools:[]});
    assert.equal(requests.length,2);
    assert.match(requests[1].messages[0].content,/no weekends/);
    assert.equal(requests[1].messages[1].content,'## Plan\n1. Prepare');
    assert.equal(result.answer,'## Plan\n1. Prepare the room.\n2. Welcome guests.');
    assert.equal(result.incomplete,false);
  } finally {
    if(previousWindow===undefined)delete globalThis.window; else globalThis.window=previousWindow;
  }
});

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

test('native tool calls override leaked malformed argument content', () => {
  const control = extractChatText({
    message: {
      content: '{"query":"""algae tree"""}',
      tool_calls: [{
        function: { name: 'web.search', arguments: '{"query":"""algae tree"""}' },
      }],
    },
  });

  assert.deepEqual(extractToolCall(control), {
    name: 'web.search',
    arguments: { query: 'algae tree' },
    raw: control,
  });
  assert.equal(stripToolControl(control), '');
});
