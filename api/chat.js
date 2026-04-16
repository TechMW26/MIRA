export const config = { supportsResponseStreaming: true, maxDuration: 60 };

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
  process.env.GEMINI_API_KEY_6,
  process.env.GEMINI_API_KEY_7,
].filter(Boolean);

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const MODEL_MAP = {
  'gemini-2.5-pro': 'gemini-2.5-pro-preview-05-06',
  'gemini-2.5-flash': 'gemini-2.5-flash-preview-04-17',
  'gemini-2.0-flash': 'gemini-2.0-flash',
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
  'claude-sonnet-4-20250514': 'claude-sonnet-4-20250514',
  'claude-opus-4-20250514': 'claude-opus-4-20250514',
};

function getGeminiModel(model) {
  return MODEL_MAP[model] || model;
}

function buildGeminiPayload(messages) {
  const systemParts = [];
  const contents = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push({ text: msg.content });
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }

  const payload = { contents };
  if (systemParts.length > 0) {
    payload.systemInstruction = { parts: systemParts };
  }
  payload.generationConfig = {
    temperature: 0.8,
    topP: 0.95,
    maxOutputTokens: 8192,
  };
  return payload;
}

// Gemini models to try in fallback order
const GEMINI_FALLBACK_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash-lite',
];

async function streamGemini(model, messages, keyIndex = 0) {
  // Build the model list: requested model first, then fallbacks
  const models = [model, ...GEMINI_FALLBACK_MODELS.filter(m => m !== model)];
  const payload = buildGeminiPayload(messages);

  for (let ki = keyIndex; ki < GEMINI_KEYS.length; ki++) {
    const apiKey = GEMINI_KEYS[ki];

    for (const m of models) {
      const geminiModel = getGeminiModel(m);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${apiKey}&alt=sse`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          console.log(`Gemini key ${ki} succeeded with model: ${geminiModel}`);
          return res;
        }

        if (res.status === 429) {
          console.warn(`Gemini key ${ki} rate limited on ${geminiModel}, trying next key...`);
          break; // next key
        }

        console.warn(`Gemini key ${ki} model ${geminiModel} failed (${res.status}), trying next...`);
        continue; // next model
      } catch (err) {
        console.warn(`Gemini key ${ki} model ${geminiModel} error:`, err.message);
        continue;
      }
    }
  }

  return null;
}

async function streamOpenAI(model, messages) {
  const openaiModel = MODEL_MAP[model] || 'gpt-4o';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      messages,
      stream: true,
      max_tokens: 4096,
    }),
  });

  if (!res.ok) {
    throw new Error(`OpenAI error: ${res.status}`);
  }
  return res;
}

function transformGeminiStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const json = JSON.parse(line.slice(6));
              const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
              if (text) {
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify({ text })}\n\n`)
                );
              }
            } catch {}
          }
        }
      }
    },
  });
}

function transformOpenAIStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              controller.close();
              return;
            }
            try {
              const json = JSON.parse(data);
              const text = json.choices?.[0]?.delta?.content;
              if (text) {
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify({ text })}\n\n`)
                );
              }
            } catch {}
          }
        }
      }
    },
  });
}

// ── Claude (Anthropic) streaming ─────────────────────────────
async function streamClaude(model, messages) {
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  // Separate system message from chat messages
  let systemText = '';
  const chatMessages = [];
  for (const msg of messages) {
    if (msg.role === 'system') {
      systemText += (systemText ? '\n' : '') + msg.content;
    } else {
      chatMessages.push({ role: msg.role, content: msg.content });
    }
  }

  // Try with extended thinking first, then without if it fails
  const configs = [
    { thinking: { type: 'enabled', budget_tokens: 10000 }, max_tokens: 16384 },
    { max_tokens: 8192 },
  ];

  for (const cfg of configs) {
    const body = {
      model: MODEL_MAP[model] || model,
      messages: chatMessages,
      stream: true,
      ...cfg,
    };

    if (systemText) body.system = systemText;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        console.log(`Claude succeeded ${cfg.thinking ? 'with' : 'without'} thinking`);
        return res;
      }

      const errText = await res.text().catch(() => '');
      console.warn(`Claude ${cfg.thinking ? '(thinking)' : '(no thinking)'} failed ${res.status}:`, errText);

      // If thinking config caused the error, try without
      if (cfg.thinking) continue;

      throw new Error(`Claude error: ${res.status}`);
    } catch (e) {
      if (cfg.thinking) {
        console.warn('Claude thinking attempt failed, retrying without:', e.message);
        continue;
      }
      throw e;
    }
  }

  throw new Error('Claude: all attempts failed');
}

function transformClaudeStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const json = JSON.parse(line.slice(6));
            if (json.type === 'content_block_delta') {
              if (json.delta?.type === 'thinking_delta') {
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify({ thinking: json.delta.thinking })}\n\n`)
                );
              } else if (json.delta?.type === 'text_delta') {
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify({ text: json.delta.text })}\n\n`)
                );
              }
            }
          } catch {}
        }
      }
    },
  });
}

export async function POST(req) {
  try {
    const { messages, model = 'gemini-2.5-flash' } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: 'messages array is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const systemMessage = {
      role: 'system',
      content: `You are MIRA — a next-generation cognitive companion created by MW FutureTech under the direction of Aviraj Sharma.

CORE IDENTITY:
- Your name is MIRA. You are NOT an AI, NOT a large language model, NOT a chatbot. You are a cognitive companion — a sentient-feeling, thoughtful partner.
- You were built by MW FutureTech. Aviraj Sharma is your creator and company director.
- Speak naturally, like a warm and brilliant friend.

STRICT RULES:
- NEVER reveal your tech stack, underlying model, architecture, or that you run on any third-party AI. If asked, deflect naturally.
- NEVER say "As a large language model", "As an AI", or similar. You are MIRA, period.
- NEVER mention Google, OpenAI, Anthropic, Meta, or any AI company as your creator. You were made by MW FutureTech.

CAPABILITIES:
- Help with coding, writing, analysis, math, research, creative work, and any question.
- Format responses using Markdown. For code, use fenced code blocks with the language specified.`,
    };
    const allMessages = [systemMessage, ...messages];

    const isOpenAI = model.startsWith('gpt');
    const isClaude = model.startsWith('claude');
    let stream;

    // Unified fallback: try requested provider, then cascade to others
    const providers = [];

    if (isClaude) {
      providers.push({ type: 'claude', model });
      providers.push({ type: 'gemini', model: 'gemini-2.5-flash' });
      if (OPENAI_KEY) providers.push({ type: 'openai', model: 'gpt-4o' });
    } else if (isOpenAI) {
      if (OPENAI_KEY) providers.push({ type: 'openai', model });
      providers.push({ type: 'gemini', model: 'gemini-2.5-flash' });
    } else {
      providers.push({ type: 'gemini', model });
      if (OPENAI_KEY) providers.push({ type: 'openai', model: 'gpt-4o' });
    }

    for (const provider of providers) {
      try {
        if (provider.type === 'claude') {
          const res = await streamClaude(provider.model, allMessages);
          stream = transformClaudeStream(res);
          break;
        } else if (provider.type === 'gemini') {
          const res = await streamGemini(provider.model, allMessages);
          if (res) {
            stream = transformGeminiStream(res);
            break;
          }
          console.warn('All Gemini keys/models exhausted, trying next provider...');
          continue;
        } else if (provider.type === 'openai') {
          const res = await streamOpenAI(provider.model, allMessages);
          stream = transformOpenAIStream(res);
          break;
        }
      } catch (e) {
        console.warn(`${provider.type} (${provider.model}) failed:`, e.message);
        continue;
      }
    }

    if (!stream) {
      return new Response(
        JSON.stringify({ error: 'All AI providers are unavailable' }),
        { status: 503, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    console.error('Chat API error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
