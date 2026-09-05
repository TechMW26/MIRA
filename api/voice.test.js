import test from 'node:test';
import assert from 'node:assert/strict';
import { GET as health } from './voice-health.js';
import { POST as speech } from './voice-speech.js';
import { POST as chat } from './voice-chat.js';

async function withVoiceEnvironment(run) {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.MIRA_VOICE_API_URL;
  const previousKey = process.env.MIRA_VOICE_API_KEY;
  process.env.MIRA_VOICE_API_URL = 'https://voice.example.test';
  process.env.MIRA_VOICE_API_KEY = 'server-only-token';
  try { await run(); } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.MIRA_VOICE_API_URL;
    else process.env.MIRA_VOICE_API_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MIRA_VOICE_API_KEY;
    else process.env.MIRA_VOICE_API_KEY = previousKey;
  }
}

async function withDeepSeekEnvironment(run) {
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  const previousUrl = process.env.DEEPSEEK_API_URL;
  const previousModel = process.env.DEEPSEEK_CHAT_MODEL;
  process.env.DEEPSEEK_API_KEY = 'deepseek-server-secret';
  process.env.DEEPSEEK_API_URL = 'https://deepseek.example.test';
  process.env.DEEPSEEK_CHAT_MODEL = 'deepseek-v4-flash';
  try { await run(); } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
    if (previousUrl === undefined) delete process.env.DEEPSEEK_API_URL;
    else process.env.DEEPSEEK_API_URL = previousUrl;
    if (previousModel === undefined) delete process.env.DEEPSEEK_CHAT_MODEL;
    else process.env.DEEPSEEK_CHAT_MODEL = previousModel;
  }
}

test('voice health reports a deployment configuration error clearly', async () => {
  const previousUrl = process.env.MIRA_VOICE_API_URL;
  const previousKey = process.env.MIRA_VOICE_API_KEY;
  delete process.env.MIRA_VOICE_API_URL;
  delete process.env.MIRA_VOICE_API_KEY;
  try {
    const response = await health(new Request('http://localhost/api/voice-health'));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ready: false,
      error: 'Voice mode is not configured on this deployment.',
    });
  } finally {
    if (previousUrl === undefined) delete process.env.MIRA_VOICE_API_URL;
    else process.env.MIRA_VOICE_API_URL = previousUrl;
    if (previousKey === undefined) delete process.env.MIRA_VOICE_API_KEY;
    else process.env.MIRA_VOICE_API_KEY = previousKey;
  }
});

test('voice speech proxy keeps its VPS credential server-side', async () => {
  await withVoiceEnvironment(async () => {
    let upstream;
    globalThis.fetch = async (url, options) => {
      upstream = { url: String(url), options };
      return new Response(new Uint8Array([82, 73, 70, 70]), {
        status: 200,
        headers: { 'Content-Type': 'audio/wav', 'X-Mira-Language': 'hi' },
      });
    };
    const response = await speech(new Request('http://localhost/api/voice-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'नमस्ते', language: 'hi' }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-language'), 'hi');
    assert.equal(upstream.url, 'https://voice.example.test/v1/audio/speech');
    assert.equal(upstream.options.headers.Authorization, 'Bearer server-only-token');
    assert.doesNotMatch(upstream.options.body, /server-only-token/);
  });
});

test('voice chat streams from the DeepSeek voice provider with Mira and conversation context', async () => {
  await withDeepSeekEnvironment(async () => {
    let upstream;
    globalThis.fetch = async (url, options) => {
      upstream = { url: String(url), options };
      return new Response('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };
    const response = await chat(new Request('http://localhost/api/voice-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'assistant', content: 'Earlier context' },
          { role: 'user', content: 'Hello' },
        ],
        systemPrompt: 'Project context: CANACT.',
      }),
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-mira-provider'), 'deepseek');
    assert.equal(upstream.url, 'https://deepseek.example.test/chat/completions');
    assert.equal(upstream.options.headers.Authorization, 'Bearer deepseek-server-secret');
    const body = JSON.parse(upstream.options.body);
    assert.equal(body.model, 'deepseek-v4-flash');
    assert.equal(body.stream, true);
    assert.equal(body.thinking.type, 'disabled');
    assert.match(body.messages[0].content, /You are Mira/);
    assert.match(body.messages[0].content, /no Markdown/);
    assert.match(body.messages[0].content, /\[MIRA_WEB_SEARCH: concise search query\]/);
    assert.match(body.messages[0].content, /never emit XML tags/);
    assert.match(body.messages[0].content, /Project context: CANACT/);
    assert.deepEqual(body.messages.slice(-2), [
      { role: 'assistant', content: 'Earlier context' },
      { role: 'user', content: 'Hello' },
    ]);
  });
});

test('voice chat requires a DeepSeek key and reports a clear configuration error', async () => {
  const previousKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const response = await chat(new Request('http://localhost/api/voice-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
    }));
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: 'Voice conversations are not configured on this deployment.',
    });
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});
