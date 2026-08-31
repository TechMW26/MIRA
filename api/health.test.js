import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from './health.js';

test('reports ready when at least one chat provider is configured', async () => {
  const previousBaseUrl = process.env.MIRA_OPENAI_BASE_URL;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.MIRA_OPENAI_BASE_URL = 'https://mira.example.test/v1';
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const response = await GET();
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ready, true);
    assert.equal(payload.registryReachable, true);
    assert.equal(payload.completionModelCount, 1);
    assert.equal(payload.loadedModelCount, 1);
    assert.equal(payload.modelWarm, true);
    assert.equal(payload.state, 'ready');
    assert.deepEqual(payload.providers, ['mira']);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.MIRA_OPENAI_BASE_URL;
    else process.env.MIRA_OPENAI_BASE_URL = previousBaseUrl;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test('reports both providers when MIRA and DeepSeek are configured', async () => {
  const previousBaseUrl = process.env.MIRA_OPENAI_BASE_URL;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.MIRA_OPENAI_BASE_URL = 'https://mira.example.test/v1';
  process.env.DEEPSEEK_API_KEY = 'deepseek-server-secret';
  try {
    const payload = await (await GET()).json();
    assert.equal(payload.ready, true);
    assert.equal(payload.completionModelCount, 2);
    assert.deepEqual(payload.providers, ['mira', 'deepseek']);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.MIRA_OPENAI_BASE_URL;
    else process.env.MIRA_OPENAI_BASE_URL = previousBaseUrl;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test('reports unconfigured when no chat provider is configured', async () => {
  const previousBaseUrl = process.env.MIRA_OPENAI_BASE_URL;
  const previousBase = process.env.MIRA_BASE_URL;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.MIRA_OPENAI_BASE_URL;
  delete process.env.MIRA_BASE_URL;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const response = await GET();
    assert.equal(response.status, 503);
    const payload = await response.json();
    assert.equal(payload.ready, false);
    assert.equal(payload.state, 'unconfigured');
  } finally {
    if (previousBaseUrl === undefined) delete process.env.MIRA_OPENAI_BASE_URL;
    else process.env.MIRA_OPENAI_BASE_URL = previousBaseUrl;
    if (previousBase === undefined) delete process.env.MIRA_BASE_URL;
    else process.env.MIRA_BASE_URL = previousBase;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});
