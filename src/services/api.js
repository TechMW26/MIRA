const GEMINI_KEYS = [
  'AIzaSyDskZLyxaQaZV26i-Ra6DbhwHf45DJnKbI',
  'AIzaSyAiYPMILL4CErXYhzllFqY7k1_0ZAkrcRo',
  'AIzaSyD4oy3mhqAx-ZI0qPdaUZO-z7GQaxKx210',
  'AIzaSyDAujScpHJd5FBmOFfxfhhjmcQbUQ2WEYI',
  'AIzaSyBwJNNsrPkeLRpOX08eOWQcQ_sCr431rzs',
  'AIzaSyAlFosn1ZV6tgVo-uQ5cRd2IteDTxMWssU',
  'AIzaSyBgH2ZeX9jultw9bjaqEKJ_J9VzYSfMaMY',
];

const OPENAI_KEY = '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';

const MODEL_MAP = {
  'gemini-2.5-pro': 'gemini-2.5-pro-preview-05-06',
  'gemini-2.5-flash': 'gemini-2.5-flash-preview-04-17',
  'gemini-2.0-flash': 'gemini-2.0-flash',
  'gpt-4o': 'gpt-4o',
  'gpt-4o-mini': 'gpt-4o-mini',
};

const SYSTEM_PROMPT =
  'You are MIRA (Multi-Intelligent Responsive Assistant), a helpful, creative, and knowledgeable AI assistant. You can help with coding, writing, analysis, math, and general questions. Format responses using Markdown when appropriate. For code, always use fenced code blocks with the language specified.';

function buildGeminiPayload(messages) {
  const contents = [];
  for (const msg of messages) {
    if (msg.role === 'system') continue;
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    });
  }
  return {
    contents,
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 8192 },
  };
}

async function tryGeminiStream(model, messages, keyIndex = 0) {
  if (keyIndex >= GEMINI_KEYS.length) return null;

  const apiKey = GEMINI_KEYS[keyIndex];
  const geminiModel = MODEL_MAP[model] || model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:streamGenerateContent?key=${apiKey}&alt=sse`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGeminiPayload(messages)),
    });

    if (!res.ok) {
      console.warn(`Gemini key ${keyIndex} failed (${res.status}), trying next...`);
      return tryGeminiStream(model, messages, keyIndex + 1);
    }
    return res;
  } catch (err) {
    console.warn(`Gemini key ${keyIndex} error:`, err.message);
    return tryGeminiStream(model, messages, keyIndex + 1);
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
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
      stream: true,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  return res;
}

export async function sendChatMessage(messages, model = 'gemini-2.5-flash', onChunk) {
  const isOpenAI = model.startsWith('gpt');
  let response;

  if (isOpenAI) {
    response = await streamOpenAI(model, messages);
  } else {
    response = await tryGeminiStream(model, messages);
    if (!response) {
      // Fallback to OpenAI if all Gemini keys exhausted
      console.log('All Gemini keys failed, falling back to OpenAI');
      response = await streamOpenAI('gpt-4o', messages);
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);

        // Gemini format
        const geminiText = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (geminiText) {
          fullText += geminiText;
          onChunk?.(fullText, geminiText);
          continue;
        }

        // OpenAI format
        const openaiText = json.choices?.[0]?.delta?.content;
        if (openaiText) {
          fullText += openaiText;
          onChunk?.(fullText, openaiText);
        }
      } catch {}
    }
  }

  return fullText;
}

export async function generateImage(prompt) {
  // Try DALL-E 3
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: '1024x1024',
        quality: 'hd',
      }),
    });

    if (!res.ok) throw new Error(`DALL-E error: ${res.status}`);
    const data = await res.json();
    return { url: data.data[0].url, revised_prompt: data.data[0].revised_prompt };
  } catch (err) {
    throw new Error(`Image generation failed: ${err.message}`);
  }
}
