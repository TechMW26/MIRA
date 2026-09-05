export const config = { maxDuration: 30 };
import { guardRequest } from './_requestSecurity.js';

const POLLINATIONS_ORIGIN = String(process.env.POLLINATIONS_API_URL || 'https://gen.pollinations.ai')
  .trim()
  .replace(/\/+$/, '');
const DEEPSEEK_ORIGIN = String(process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com')
  .trim()
  .replace(/\/+$/, '');
let cachedModel = null;
let modelCacheExpiresAt = 0;
let cachedEmbeddingModel = null;
let embeddingModelCacheExpiresAt = 0;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function serverKey() {
  return String(process.env.POLLINATIONS_API_KEY || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '');
}

function deepSeekKey() {
  return String(process.env.DEEPSEEK_API_KEY || '')
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\s+/g, '');
}

function deepSeekModel() {
  return String(
    process.env.DEEPSEEK_DESKTOP_MODEL
    || process.env.DEEPSEEK_AGENT_MODEL
    || 'deepseek-v4-pro',
  ).trim();
}

function deepSeekChatModel() {
  return String(
    process.env.DEEPSEEK_CHAT_MODEL
    || 'deepseek-v4-flash',
  ).trim();
}

function isDesktopRequest(request) {
  return request.headers.get('x-mira-desktop') === '1';
}

export function selectAssistModel(models = []) {
  const candidates = models.filter((model) => {
    const outputs = Array.isArray(model?.output_modalities) ? model.output_modalities : [];
    return model?.name && (!outputs.length || outputs.includes('text'));
  });
  return candidates
    .map((model) => {
      const description = String(model.description || '').toLowerCase();
      const name = String(model.name || '').toLowerCase();
      let score = 0;
      if (/qwen[-_ ]?coder/.test(name)) score += 12;
      if (/coder/.test(name)) score += 8;
      if (/cod(e|ing)|developer|agentic/.test(description)) score += 5;
      if (/fast|flash|compact|small|low-cost|affordable/.test(description)) score += 4;
      if (model.tools) score += 1;
      if (model.reasoning) score -= 4;
      return { model, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.model?.name || '';
}

export function selectEmbeddingModel(models = []) {
  const candidates = models.filter((model) => model?.name);
  return candidates
    .map((model) => {
      const name = String(model.name || '').toLowerCase();
      const description = String(model.description || '').toLowerCase();
      let score = 0;
      if (/qwen3[-_ ]?embedding/.test(name) || /qwen3[-_ ]?embedding/.test(description)) score += 10;
      if (/code|retrieval|semantic/.test(description)) score += 4;
      if (/small|fast|low-cost|affordable/.test(description)) score += 2;
      return { model, score };
    })
    .sort((left, right) => right.score - left.score)[0]?.model?.name || '';
}

async function assistModel(key, signal) {
  if (Date.now() < modelCacheExpiresAt) return cachedModel;
  try {
    const response = await fetch(`${POLLINATIONS_ORIGIN}/text/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal,
      cache: 'no-store',
    });
    const models = response.ok ? await response.json() : [];
    cachedModel = selectAssistModel(Array.isArray(models) ? models : []);
  } catch {
    cachedModel = '';
  }
  modelCacheExpiresAt = Date.now() + 10 * 60 * 1000;
  return cachedModel;
}

async function embeddingModel(key, signal) {
  if (Date.now() < embeddingModelCacheExpiresAt) return cachedEmbeddingModel;
  try {
    const response = await fetch(`${POLLINATIONS_ORIGIN}/embeddings/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal,
      cache: 'no-store',
    });
    const models = response.ok ? await response.json() : [];
    cachedEmbeddingModel = selectEmbeddingModel(Array.isArray(models) ? models : []);
  } catch {
    cachedEmbeddingModel = '';
  }
  embeddingModelCacheExpiresAt = Date.now() + 10 * 60 * 1000;
  return cachedEmbeddingModel;
}

function cleanSuggestion(value) {
  return String(value || '')
    .replace(/^```[^\n]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .replace(/^(?:suggestion|completion|answer):\s*/i, '')
    .trimEnd();
}

function completionPrompt({ path, language, prefix, suffix }) {
  return [
    `File: ${path || 'untitled'}`,
    `Language: ${language || 'text'}`,
    'Insert code exactly at <CURSOR>. Return only the missing code, with no markdown or explanation.',
    'Preserve local style and avoid repeating text already present.',
    '<BEFORE>',
    prefix,
    '</BEFORE>',
    '<CURSOR>',
    '<AFTER>',
    suffix,
    '</AFTER>',
  ].join('\n');
}

function reviewPrompt({ diff, status, kind }) {
  const instruction = kind === 'commit'
    ? 'Write one conventional, imperative Git commit subject under 72 characters. Return only the subject.'
    : 'Write a concise GitHub pull-request or review summary with a short heading, key changes, and validation. Return markdown only.';
  return `${instruction}\n\nGit status:\n${status}\n\nDiff:\n${diff}`;
}

function workspacePrompt({ request, evidence }) {
  return [
    'Answer the workspace request from the supplied local evidence.',
    'Be direct and factual. Never mention internal tools, model routing, fetch failures, or hidden control syntax.',
    'For a codebase study, summarize architecture, important files, scripts, dependencies, and concrete findings.',
    `User request: ${request}`,
    '<LOCAL_WORKSPACE_EVIDENCE>',
    evidence,
    '</LOCAL_WORKSPACE_EVIDENCE>',
  ].join('\n');
}

function sanitizeMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: ['system', 'assistant', 'user', 'tool'].includes(message?.role) ? message.role : 'user',
      content: String(message?.content || ''),
    }))
    .filter((message) => message.content);
}

function parseToolArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function prepareDeepSeekTools(tools = []) {
  const used = new Set();
  const aliases = new Map();
  const prepared = (Array.isArray(tools) ? tools : []).slice(0, 32).flatMap((tool) => {
    const definition = tool?.function;
    if (tool?.type !== 'function' || !definition?.name) return [];
    const originalName = String(definition.name);
    const base = originalName.replace(/[^A-Za-z0-9_-]/g, '__').slice(0, 56) || 'tool';
    let alias = base;
    let suffix = 1;
    while (used.has(alias)) alias = `${base.slice(0, 52)}_${suffix++}`;
    used.add(alias);
    aliases.set(alias, originalName);
    return [{
      type: 'function',
      function: {
        name: alias,
        description: String(definition.description || '').slice(0, 1_500),
        parameters: definition.parameters && typeof definition.parameters === 'object'
          ? definition.parameters
          : { type: 'object', properties: {} },
      },
    }];
  });
  return { tools: prepared, aliases };
}

async function pollinationsJson(url, options, attempts = 2) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const result = await response.json().catch(() => ({}));
      if (response.ok) return result;
      const error = new Error(`Pollinations request failed (${response.status}).`);
      error.status = response.status;
      if (![408, 429, 500, 502, 503, 504].includes(response.status)) throw error;
      lastError = error;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      lastError = error;
    }
    if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  throw lastError || new Error('Pollinations request failed.');
}

async function deepSeekJson(payload, signal) {
  const key = deepSeekKey();
  if (!key) throw new Error('Desktop coding assistance is not configured.');
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${DEEPSEEK_ORIGIN}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal,
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) return result;
      const error = new Error(`DeepSeek request failed (${response.status}).`);
      error.status = response.status;
      if (![408, 429, 500, 502, 503, 504].includes(response.status)) throw error;
      lastError = error;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      lastError = error;
    }
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw lastError || new Error('DeepSeek request failed.');
}

export async function requestDeepSeekChat({
  messages = [],
  systemPrompt = '',
  tools = [],
  maxTokens,
  think = false,
  signal,
  model = deepSeekChatModel(),
} = {}) {
  const chatMessages = [
    ...(systemPrompt ? [{ role: 'system', content: String(systemPrompt).slice(0, 20_000) }] : []),
    ...sanitizeMessages(messages),
  ];
  if (!chatMessages.length) throw new Error('DeepSeek chat requires messages.');
  const { tools: preparedTools, aliases } = prepareDeepSeekTools(tools);
  const result = await deepSeekJson({
    model,
    messages: chatMessages,
    temperature: 0.15,
    thinking: { type: think === true ? 'enabled' : 'disabled' },
    ...(think === true ? { reasoning_effort: 'max' } : {}),
    ...(preparedTools.length ? { tools: preparedTools, tool_choice: 'auto' } : {}),
  }, signal);
  const message = result?.choices?.[0]?.message || {};
  const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((call) => ({
    id: String(call?.id || '').slice(0, 200),
    type: 'function',
    function: {
      name: aliases.get(call?.function?.name) || String(call?.function?.name || '').slice(0, 100),
      arguments: parseToolArguments(call?.function?.arguments),
    },
  })).filter((call) => call.function.name);
  const answer = String(message.content || '').trim();
  const thinking = String(message.reasoning_content || '').trim();
  if (!answer && !toolCalls.length) throw new Error('DeepSeek chat returned no response.');
  return {
    ...(answer ? { answer } : {}),
    ...(thinking ? { thinking } : {}),
    ...(toolCalls.length ? { toolCalls } : {}),
    model: String(result?.model || model),
    finishReason: result?.choices?.[0]?.finish_reason || 'stop',
  };
}

async function requestDesktopChat(options = {}) {
  return requestDeepSeekChat({
    ...options,
    model: deepSeekModel(),
  });
}

export async function requestManagedChat({
  messages = [],
  systemPrompt = '',
  tools = [],
  maxTokens,
  signal,
} = {}) {
  const key = serverKey();
  if (!key) throw new Error('Managed chat fallback is not configured.');
  const chatMessages = [
    ...(systemPrompt ? [{ role: 'system', content: String(systemPrompt).slice(0, 20_000) }] : []),
    ...sanitizeMessages(messages),
  ];
  if (!chatMessages.length) throw new Error('Managed chat fallback requires messages.');

  const model = await assistModel(key, signal);
  const payload = {
    messages: chatMessages,
    temperature: 0.15,
    ...(Array.isArray(tools) && tools.length ? { tools: tools.slice(0, 32), tool_choice: 'auto' } : {}),
    ...(model ? { model } : {}),
  };
  const request = (requestPayload) => pollinationsJson(`${POLLINATIONS_ORIGIN}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestPayload),
    signal,
  });
  let result = await request(payload);
  if (model && !result?.choices?.[0]?.message?.content && !result?.choices?.[0]?.message?.tool_calls?.length) {
    const { model: _selectedModel, ...providerDefaultPayload } = payload;
    result = await request(providerDefaultPayload);
  }
  const toolCalls = result?.choices?.[0]?.message?.tool_calls;
  if (Array.isArray(toolCalls) && toolCalls.length) return { toolCalls, finishReason: 'tool_calls' };
  const suggestion = cleanSuggestion(result?.choices?.[0]?.message?.content, 6_000);
  if (!suggestion) throw new Error('Managed chat fallback returned no response.');
  return { suggestion, finishReason: result?.choices?.[0]?.finish_reason || 'stop' };
}

export async function POST(request) {
  const guarded = guardRequest(request, { limit: 30, windowMs: 60_000, key: 'code-assist' });
  if (guarded) return guarded;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON request.' }, 400); }
  const task = String(body?.task || 'completion');
  if (!['completion', 'github-comment', 'commit', 'workspace-synthesis', 'chat', 'embedding'].includes(task)) {
    return json({ error: 'Unsupported code-assistance task.' }, 400);
  }
  const desktopRequest = isDesktopRequest(request);
  const key = serverKey();
  if (desktopRequest && task !== 'embedding' && !deepSeekKey()) {
    return json({ error: 'Desktop coding assistance is not configured.' }, 503);
  }
  if ((!desktopRequest || task === 'embedding') && !key) {
    return json({ error: 'Code assistance is not configured.' }, 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 22_000);
  const abort = () => controller.abort();
  request.signal?.addEventListener?.('abort', abort, { once: true });
  try {
    if (task === 'embedding') {
      const input = (Array.isArray(body?.input) ? body.input : [body?.input])
        .slice(0, 32)
        .map((value) => String(value || '').slice(0, 12_000))
        .filter(Boolean);
      if (!input.length || input.join('').length > 120_000) {
        return json({ error: 'Embedding input is empty or too large.' }, 400);
      }
      const model = await embeddingModel(key, controller.signal);
      const result = await pollinationsJson(`${POLLINATIONS_ORIGIN}/v1/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ input, dimensions: 384, ...(model ? { model } : {}) }),
        signal: controller.signal,
      });
      const embeddings = (Array.isArray(result?.data) ? result.data : [])
        .sort((left, right) => Number(left.index || 0) - Number(right.index || 0))
        .map((entry) => entry?.embedding)
        .filter((entry) => Array.isArray(entry) && entry.length >= 128);
      if (embeddings.length !== input.length) return json({ error: 'The embedding service returned incomplete vectors.' }, 502);
      return json({ embeddings, model: model || 'default' });
    }

    if (task === 'chat') {
      if (!desktopRequest && body?.scope !== 'desktop-coding') {
        return json({ error: 'Chat completions are restricted to coding workspaces.' }, 403);
      }
      const result = desktopRequest ? await requestDesktopChat({
        messages: body.messages,
        systemPrompt: body.systemPrompt,
        tools: body.tools,
        maxTokens: body.maxTokens,
        signal: controller.signal,
      }) : await requestManagedChat({
        messages: body.messages,
        systemPrompt: body.systemPrompt,
        tools: body.tools,
        maxTokens: body.maxTokens,
        signal: controller.signal,
      });
      return json(result);
    }

    const prompt = task === 'completion'
      ? completionPrompt({
        path: String(body.path || '').slice(0, 500),
        language: String(body.language || '').slice(0, 80),
        prefix: String(body.prefix || '').slice(-10_000),
        suffix: String(body.suffix || '').slice(0, 4_000),
      })
      : task === 'workspace-synthesis'
        ? workspacePrompt({
          request: String(body.request || '').slice(0, 4_000),
          evidence: String(body.evidence || '').slice(0, 90_000),
        })
      : reviewPrompt({
        diff: String(body.diff || '').slice(0, 24_000),
        status: String(body.status || '').slice(0, 4_000),
        kind: task,
      });
    const chatMessages = [
      { role: 'system', content: 'You are a fast, precise coding copilot. Follow the output contract exactly and never expose credentials.' },
      { role: 'user', content: prompt },
    ];
    if (desktopRequest) {
      const model = deepSeekModel();
      const result = await deepSeekJson({
        model,
        messages: chatMessages,
        max_tokens: task === 'completion'
          ? 220
          : task === 'commit'
            ? 120
            : task === 'github-comment'
              ? 420
              : 1_600,
        temperature: 0.15,
      }, controller.signal);
      const suggestion = cleanSuggestion(result?.choices?.[0]?.message?.content, task === 'completion' ? 4_000 : 12_000);
      if (!suggestion) return json({ error: 'The coding assistant returned no suggestion.' }, 502);
      return json({ suggestion, model });
    }

    const model = await assistModel(key, controller.signal);
    const payload = {
      messages: chatMessages,
      max_tokens: task === 'completion'
        ? 220
        : task === 'commit'
          ? 120
          : task === 'github-comment'
            ? 420
            : 1_200,
      temperature: 0.15,
      ...(model ? { model } : {}),
    };
    let result = await pollinationsJson(`${POLLINATIONS_ORIGIN}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (model && !result?.choices?.[0]?.message?.content && !result?.choices?.[0]?.message?.tool_calls?.length) {
      const { model: _selectedModel, ...providerDefaultPayload } = payload;
      result = await pollinationsJson(`${POLLINATIONS_ORIGIN}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(providerDefaultPayload),
        signal: controller.signal,
      });
    }
    const suggestion = cleanSuggestion(result?.choices?.[0]?.message?.content, task === 'completion' ? 4_000 : 6_000);
    if (!suggestion) return json({ error: 'The coding assistant returned no suggestion.' }, 502);
    return json({ suggestion });
  } catch (error) {
    return json({ error: error?.name === 'AbortError' ? 'The coding assistant timed out.' : 'The coding assistant is unavailable.' }, 503);
  } finally {
    clearTimeout(timeout);
    request.signal?.removeEventListener?.('abort', abort);
  }
}
