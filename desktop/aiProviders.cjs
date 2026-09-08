const DEFAULT_DEEPSEEK_ORIGIN = 'https://api.deepseek.com';
const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-pro';

function normalizedOrigin(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, '');
}

function cleanText(value) {
  return String(value || '').replace(/\u0000/g, '');
}

function parseArguments(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function sanitizeMessages(messages = []) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => ({
      role: ['system', 'assistant', 'user'].includes(message?.role) ? message.role : 'user',
      content: cleanText(message?.content, 80_000),
    }))
    .filter((message) => message.content);
}

function toolAlias(name, used) {
  const base = String(name || 'tool').replace(/[^A-Za-z0-9_-]/g, '__').slice(0, 56) || 'tool';
  let alias = base;
  let suffix = 1;
  while (used.has(alias)) alias = `${base.slice(0, 52)}_${suffix++}`;
  used.add(alias);
  return alias;
}

function prepareDeepSeekTools(tools = []) {
  const used = new Set();
  const aliases = new Map();
  const prepared = (Array.isArray(tools) ? tools : []).slice(0, 96).flatMap((tool) => {
    const definition = tool?.function;
    if (tool?.type !== 'function' || !definition?.name) return [];
    const alias = toolAlias(definition.name, used);
    aliases.set(alias, definition.name);
    return [{
      type: 'function',
      function: {
        name: alias,
        description: cleanText(definition.description, 1_500),
        parameters: definition.parameters && typeof definition.parameters === 'object'
          ? definition.parameters
          : { type: 'object', properties: {} },
      },
    }];
  });
  return { tools: prepared, aliases };
}

async function requestJson(url, options, { attempts = 2, fetchImpl = globalThis.fetch } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, options);
      const payload = await response.json().catch(() => ({}));
      if (response.ok) return payload;
      const message = payload?.error?.message || payload?.error || `Provider request failed (${response.status}).`;
      const error = new Error(String(message));
      error.status = response.status;
      if (![408, 429, 500, 502, 503, 504].includes(response.status)) throw error;
      lastError = error;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      lastError = error;
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError || new Error('The provider request failed.');
}

function authorizationHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function requestDeepSeekChat({
  apiKey,
  messages = [],
  systemPrompt = '',
  tools = [],
  maxTokens = 4_096,
  think = true,
  signal,
  fetchImpl,
  origin = process.env.DEEPSEEK_API_URL,
  model = process.env.DEEPSEEK_AGENT_MODEL,
} = {}) {
  if (!String(apiKey || '').trim()) throw new Error('The desktop coding provider is not configured.');
  const { tools: preparedTools, aliases } = prepareDeepSeekTools(tools);
  const preparedMessages = [
    ...(systemPrompt ? [{ role: 'system', content: cleanText(systemPrompt, 30_000) }] : []),
    ...sanitizeMessages(messages),
  ];
  if (!preparedMessages.length) throw new Error('The coding request has no messages.');
  const payload = {
    model: String(model || DEFAULT_DEEPSEEK_MODEL),
    messages: preparedMessages,
    max_tokens: Math.max(256, Math.min(16_384, Number(maxTokens) || 4_096)),
    thinking: { type: think === false ? 'disabled' : 'enabled' },
    ...(think === false ? {} : { reasoning_effort: 'max' }),
    ...(preparedTools.length ? { tools: preparedTools, tool_choice: 'auto' } : {}),
  };
  const result = await requestJson(
    `${normalizedOrigin(origin, DEFAULT_DEEPSEEK_ORIGIN)}/chat/completions`,
    {
      method: 'POST',
      headers: authorizationHeaders(String(apiKey).trim()),
      body: JSON.stringify(payload),
      signal,
    },
    { fetchImpl },
  );
  const message = result?.choices?.[0]?.message || {};
  const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((call) => ({
    id: cleanText(call?.id, 200),
    type: 'function',
    function: {
      name: aliases.get(call?.function?.name) || cleanText(call?.function?.name, 100),
      arguments: parseArguments(call?.function?.arguments),
    },
  })).filter((call) => call.function.name);
  return {
    answer: cleanText(message.content, 100_000).trim(),
    thinking: cleanText(message.reasoning_content, 100_000).trim(),
    finishReason: result?.choices?.[0]?.finish_reason || 'stop',
    toolCalls,
    model: String(result?.model || payload.model),
  };
}

async function requestDeepSeekCompletion({
  apiKey,
  prefix = '',
  suffix = '',
  maxTokens = 256,
  signal,
  fetchImpl,
  origin = process.env.DEEPSEEK_API_URL,
  model = process.env.DEEPSEEK_AGENT_MODEL,
} = {}) {
  if (!String(apiKey || '').trim()) throw new Error('The desktop coding provider is not configured.');
  const result = await requestJson(
    `${normalizedOrigin(origin, DEFAULT_DEEPSEEK_ORIGIN)}/beta/completions`,
    {
      method: 'POST',
      headers: authorizationHeaders(String(apiKey).trim()),
      body: JSON.stringify({
        model: String(model || DEFAULT_DEEPSEEK_MODEL),
        prompt: cleanText(prefix, 80_000),
        suffix: cleanText(suffix, 30_000),
        max_tokens: Math.max(32, Math.min(1_024, Number(maxTokens) || 256)),
      }),
      signal,
    },
    { fetchImpl },
  );
  return cleanText(result?.choices?.[0]?.text, 12_000).trimEnd();
}

async function validateDeepSeekKey(apiKey, options = {}) {
  const result = await requestDeepSeekChat({
    ...options,
    apiKey,
    messages: [{ role: 'user', content: 'Return only the lowercase word ok.' }],
    maxTokens: 16,
    think: false,
    tools: [],
  });
  return Boolean(result.answer);
}

module.exports = {
  prepareDeepSeekTools,
  requestDeepSeekChat,
  requestDeepSeekCompletion,
  validateDeepSeekKey,
};
