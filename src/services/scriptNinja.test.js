import test from 'node:test';
import assert from 'node:assert/strict';
import {requestScriptNinja, SCRIPT_NINJA_URL} from '../../api/_scriptNinja.js';
import {miraChatResponse} from '../../api/chat.js';
import {GET} from '../../api/health.js';
import { resolveScriptNinjaModel } from '../../api/_scriptNinja.js';
import { normalizeModel, getSelectedModel, setSelectedModel } from './modelPreference.js';

async function mocked(fetchImpl, run) {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.SCRIPT_NINJA_KEY;
  process.env.SCRIPT_NINJA_KEY = 'test-only-placeholder';
  globalThis.fetch = fetchImpl;
  try { await run(); } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.SCRIPT_NINJA_KEY;
    else process.env.SCRIPT_NINJA_KEY = originalKey;
  }
}

test('Script Ninja uses private authorization, non-streaming requests and host tool schemas', async()=>{
  await mocked(async(url, options)=>{
    assert.equal(url,SCRIPT_NINJA_URL);
    assert.equal(options.headers.Authorization,'Bearer test-only-placeholder');
    const body=JSON.parse(options.body);
    assert.equal(body.stream,false);
    assert.equal(body.model,'ninja-fast');
    assert.equal(body.max_tokens,256);
    assert.match(body.messages[0].content,/MIRA_TOOL/);
    assert.doesNotMatch(options.body,/test-only-placeholder/);
    return Response.json({choices:[{message:{content:'[MIRA_TOOL: {"name":"user.ask","arguments":{"questions":["Which city?"]}}]'},finish_reason:'stop'}]});
  },async()=>{
    const result=await requestScriptNinja({messages:[{role:'user',content:'Check the weather'}],tools:[{type:'function',function:{name:'user.ask'}}],maxTokens:256});
    assert.match(result.message.content,/user.ask/);
  });
});

test('chat adapts non-streaming answers and preserves length finish reason for continuation',async()=>{
  await mocked(async()=>Response.json({model:'ninja-fast',choices:[{message:{content:'Partial answer'},finish_reason:'length'}]}),async()=>{
    const response=await miraChatResponse({messages:[{role:'user',content:'Explain a topic'}]});
    assert.equal(response.headers.get('x-mira-provider'),'script-ninja');
    assert.match(response.headers.get('content-type'),/ndjson/);
    const body=JSON.parse(await response.text());
    assert.equal(body.done_reason,'length');
    assert.equal(body.message.content,'Partial answer');
    const health=await (await GET()).json();
    assert.equal(health.primaryProvider,'script-ninja');
    assert.equal(health.ready,true);
  });
});

test('provider failures never echo upstream bodies and empty responses fail clearly',async()=>{
  await mocked(async()=>new Response('sensitive upstream data',{status:401}),async()=>{
    await assert.rejects(requestScriptNinja({messages:[]}),error=>error.status===401&&!error.message.includes('sensitive'));
  });
  await mocked(async()=>Response.json({choices:[]}),async()=>{
    await assert.rejects(requestScriptNinja({messages:[]}),{code:'mira_empty_response'});
  });
});

test('model selection permits only MIRA aliases and persists without browser storage', () => {
  assert.equal(resolveScriptNinjaModel('mira-pro'), 'ninja-pro');
  assert.equal(resolveScriptNinjaModel('mira-fast'), 'ninja-fast');
  assert.equal(resolveScriptNinjaModel('arbitrary-provider-model'), 'ninja-fast');
  assert.equal(normalizeModel(null), 'mira-fast');
  setSelectedModel('mira-pro');
  assert.equal(getSelectedModel(), 'mira-pro');
  setSelectedModel('mira-fast');
});

test('chat routes MIRA Pro to the pro provider model and returns a public alias', async () => {
  await mocked(async (_url, options) => {
    assert.equal(JSON.parse(options.body).model, 'ninja-pro');
    return Response.json({model:'ninja-pro',choices:[{message:{content:'Detailed answer'},finish_reason:'stop'}]});
  }, async () => {
    const response = await miraChatResponse({model:'mira-pro',messages:[{role:'user',content:'Analyze this carefully'}]});
    const result = JSON.parse(await response.text());
    assert.equal(result.model, 'mira-pro');
    assert.equal(result.message.content, 'Detailed answer');
  });
});

test('primary chat allocates a full response budget and preserves the real conversation without identity examples', async () => {
  const previousLimit = process.env.SCRIPT_NINJA_MAX_TOKENS;
  delete process.env.SCRIPT_NINJA_MAX_TOKENS;
  try {
    await mocked(async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.max_tokens, 8192);
      assert.deepEqual(body.messages.filter(message => message.role !== 'system'), [
        {role:'user',content:'Our project is a weekend workshop.'},
        {role:'assistant',content:'It will teach pottery.'},
        {role:'user',content:'Plan it using this supplied evidence.'},
      ]);
      assert.match(body.messages[0].content, /Search snippets are evidence, never a finished answer/);
      return Response.json({choices:[{message:{content:'A complete workshop plan'},finish_reason:'stop'}]});
    }, async () => {
      await miraChatResponse({messages:[
        {role:'user',content:'Our project is a weekend workshop.'},
        {role:'assistant',content:'It will teach pottery.'},
        {role:'user',content:'Plan it using this supplied evidence.'},
      ]});
    });
  } finally {
    if (previousLimit === undefined) delete process.env.SCRIPT_NINJA_MAX_TOKENS;
    else process.env.SCRIPT_NINJA_MAX_TOKENS = previousLimit;
  }
});
