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

const MODEL_MAP = {
  'gemini-2.5-pro': 'gemini-2.5-pro-preview-05-06',
  'gemini-2.5-flash': 'gemini-2.5-flash-preview-04-17',
  'gemini-2.0-flash': 'gemini-2.0-flash',
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
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

async function streamGemini(model, messages, keyIndex = 0) {
  if (keyIndex >= GEMINI_KEYS.length) return null;

  const apiKey = GEMINI_KEYS[keyIndex];
  const geminiModel = getGeminiModel(model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${apiKey}&alt=sse`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGeminiPayload(messages)),
    });

    if (!res.ok) {
      console.error(`Gemini key ${keyIndex} failed: ${res.status}`);
      return streamGemini(model, messages, keyIndex + 1);
    }

    return res;
  } catch (err) {
    console.error(`Gemini key ${keyIndex} error:`, err.message);
    return streamGemini(model, messages, keyIndex + 1);
  }
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
    let stream;

    if (isOpenAI) {
      const res = await streamOpenAI(model, allMessages);
      stream = transformOpenAIStream(res);
    } else {
      const geminiRes = await streamGemini(model, allMessages);
      if (geminiRes) {
        stream = transformGeminiStream(geminiRes);
      } else if (OPENAI_KEY) {
        // Fallback to OpenAI if all Gemini keys fail
        console.log('All Gemini keys exhausted, falling back to OpenAI');
        const res = await streamOpenAI('gpt-4o', allMessages);
        stream = transformOpenAIStream(res);
      } else {
        return new Response(
          JSON.stringify({ error: 'All AI providers are unavailable' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      }
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
