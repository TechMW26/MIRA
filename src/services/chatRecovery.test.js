import test from 'node:test';
import assert from 'node:assert/strict';
import { runChatCompletion, sendChatMessage } from './api.js';

test('diagnoses and retries one transient chat failure', async () => {
  const originalFetch = globalThis.fetch;
  let generationAttempts = 0;
  let cancellationCalls = 0;
  let healthCalls = 0;

  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === '/api/health') {
      healthCalls += 1;
      return new Response(JSON.stringify({
        ready: true,
        registryReachable: true,
        loadedModelCount: 1,
        latencyMs: 5,
      }), { status: 200 });
    }

    const body = JSON.parse(options.body || '{}');
    if (body.action === 'cancel') {
      cancellationCalls += 1;
      return new Response(JSON.stringify({ cancelled: true }), { status: 200 });
    }

    generationAttempts += 1;
    if (generationAttempts === 1) {
      return new Response(JSON.stringify({ error: 'Model temporarily unavailable.' }), { status: 503 });
    }
    return new Response(`${JSON.stringify({ message: { content: 'Recovered response.' }, done: true })}\n`, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    });
  };

  try {
    const response = await runChatCompletion({
      messages: [{ role: 'user', content: 'Hello' }],
      think: false,
    });
    assert.equal(response.result, 'Recovered response.');
    assert.equal(generationAttempts, 2);
    assert.equal(cancellationCalls, 1);
    assert.equal(healthCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('does not send the same request twice while the model host is cold', async () => {
  const originalFetch = globalThis.fetch;
  let generationAttempts = 0;
  let cancellationCalls = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === '/api/health') {
      return new Response(JSON.stringify({
        ready: true,
        registryReachable: true,
        completionModelCount: 2,
        loadedModelCount: 0,
        state: 'cold',
      }), { status: 200 });
    }
    const body = JSON.parse(options.body || '{}');
    if (body.action === 'cancel') {
      cancellationCalls += 1;
      return new Response(JSON.stringify({ cancelled: true }), { status: 200 });
    }
    generationAttempts += 1;
    return new Response(JSON.stringify({
      error: 'The model is still starting. Please retry shortly.',
      code: 'upstream_start_timeout',
    }), { status: 504 });
  };

  try {
    await assert.rejects(runChatCompletion({
      messages: [{ role: 'user', content: 'Hello' }],
      think: false,
    }), /still starting/i);
    assert.equal(generationAttempts, 1);
    assert.equal(cancellationCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('never routes ordinary chat through the Pollinations coding fallback', async () => {
  const originalFetch = globalThis.fetch;
  let generationAttempts = 0;
  let fallbackCalls = 0;

  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === '/api/health') {
      return new Response(JSON.stringify({ ready: true, registryReachable: true }), { status: 200 });
    }

    const body = JSON.parse(options.body || '{}');
    if (String(url) === '/api/code-assist') {
      fallbackCalls += 1;
      assert.equal(body.task, 'chat');
      return new Response(JSON.stringify({ suggestion: 'Fallback response.' }), { status: 200 });
    }
    if (body.action === 'cancel') {
      return new Response(JSON.stringify({ cancelled: true }), { status: 200 });
    }

    generationAttempts += 1;
    return new Response(JSON.stringify({ error: 'Model temporarily unavailable.' }), { status: 503 });
  };

  try {
    await assert.rejects(sendChatMessage(
      [{ role: 'user', content: 'Summarise this workspace.' }],
      () => {},
      [],
      { think: false },
    ), /Model temporarily unavailable/);
    assert.equal(generationAttempts, 2);
    assert.equal(fallbackCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('keeps Pollinations completion fallback scoped to desktop coding work', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let fallbackCalls = 0;
  globalThis.window = {
    miraDesktop: {
      requestAgentChat: async () => ({ ok: false, error: 'DeepSeek unavailable.' }),
    },
  };
  globalThis.fetch = async (url, options = {}) => {
    const body = JSON.parse(options.body || '{}');
    if (String(url) === '/api/health') {
      return new Response(JSON.stringify({ ready: false }), { status: 503 });
    }
    if (String(url) === '/api/code-assist') {
      fallbackCalls += 1;
      return new Response(JSON.stringify({ suggestion: 'Coding fallback response.' }), { status: 200 });
    }
    if (body.action === 'cancel') return new Response('{}', { status: 200 });
    assert.equal(body.desktopCoding, true);
    return new Response(JSON.stringify({ error: 'Model temporarily unavailable.' }), { status: 503 });
  };
  try {
    const response = await sendChatMessage(
      [{ role: 'user', content: 'Fix this workspace.' }],
      () => {},
      [],
      { desktopCoding: true, think: false },
    );
    assert.equal(response, 'Coding fallback response.');
    assert.equal(fallbackCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('uses the desktop coding provider only for explicitly marked coding work', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let desktopCalls = 0;
  let primaryCalls = 0;

  globalThis.window = {
    miraDesktop: {
      invokeTool: async () => ({ ok: true }),
      requestAgentChat: async () => {
        desktopCalls += 1;
        return { ok: true, answer: 'Desktop coding response.', toolCalls: [] };
      },
    },
  };
  globalThis.fetch = async () => {
    primaryCalls += 1;
    return new Response(`${JSON.stringify({ message: { content: 'Self-hosted response.' }, done: true })}\n`, {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
    });
  };

  try {
    const regular = await sendChatMessage(
      [{ role: 'user', content: 'Tell me a story.' }],
      () => {},
      [],
      { think: false },
    );
    assert.equal(regular, 'Self-hosted response.');
    assert.equal(desktopCalls, 0);
    assert.equal(primaryCalls, 1);

    const coding = await sendChatMessage(
      [{ role: 'user', content: 'Fix this function.' }],
      () => {},
      [],
      { desktopCoding: true, think: false },
    );
    assert.equal(coding, 'Desktop coding response.');
    assert.equal(desktopCalls, 1);
    assert.equal(primaryCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
