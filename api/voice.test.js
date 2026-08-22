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

async function withOllamaEnvironment(run) {
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.OLLAMA_API_URL;
  const previousModel = process.env.OLLAMA_VOICE_MODEL;
  process.env.OLLAMA_API_URL = 'https://ollama.example.test/api/chat';
  delete process.env.OLLAMA_VOICE_MODEL;
  try { await run(); } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.OLLAMA_API_URL;
    else process.env.OLLAMA_API_URL = previousUrl;
    if (previousModel === undefined) delete process.env.OLLAMA_VOICE_MODEL;
    else process.env.OLLAMA_VOICE_MODEL = previousModel;
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

test('voice chat streams from the self-hosted non-vision model with Mira and conversation context', async () => {
  await withOllamaEnvironment(async () => {
    let upstream;
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/api/tags')) {
        return Response.json({
          models: [
            { name: 'vision-runtime', capabilities: ['completion', 'vision', 'tools', 'thinking'] },
            { name: 'qwen-runtime', capabilities: ['completion', 'tools'] },
          ],
        });
      }
      upstream = { url: String(url), options };
      return new Response('{"message":{"role":"assistant","content":"Hello"},"done":false}\n', {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
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
    assert.match(await response.text(), /Hello/);
    assert.equal(upstream.url, 'https://ollama.example.test/api/chat');
    assert.equal(upstream.options.headers.Authorization, undefined);
    const body = JSON.parse(upstream.options.body);
    assert.equal(body.model, 'qwen-runtime');
    assert.equal(body.stream, true);
    assert.equal(body.think, undefined);
    assert.equal(body.options.num_predict, 480);
    assert.match(body.messages[0].content, /You are Mira/);
    assert.match(body.messages[0].content, /no Markdown/);
    assert.match(body.messages[0].content, /\[MIRA_WEB_SEARCH: concise search query\]/);
    assert.match(body.messages[0].content, /never emit XML tags/);
    assert.match(body.messages[0].content, /Project context: CANACT/);
    assert.deepEqual(body.messages.slice(-2), [
      { role: 'assistant', content: 'Earlier context' },
      { role: 'user', content: 'Hello' },
    ]);
    assert.doesNotMatch(upstream.options.body, /deepseek/i);
  });
});

test('voice chat stays on Ollama even when a DeepSeek key is configured', async () => {
  const originalKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'deepseek-server-secret';
  try {
    await withOllamaEnvironment(async () => {
      const requestedUrls = [];
      globalThis.fetch = async (url) => {
        requestedUrls.push(String(url));
        if (String(url).endsWith('/api/tags')) {
          return Response.json({ models: [{ name: 'voice-model', capabilities: ['completion'] }] });
        }
        return new Response('{"message":{"content":"Hello from Ollama voice."},"done":true}\n', {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        });
      };
      const response = await chat(new Request('http://localhost/api/voice-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hello' }] }),
      }));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-mira-provider'), 'ollama');
      assert.match(await response.text(), /Hello from Ollama voice/);
      assert.equal(requestedUrls.some((url) => /deepseek/i.test(url)), false);
    });
  } finally {
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});
