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

// Models to try in order of preference (plain names, no preview suffixes)
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

const SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
];

const SYSTEM_PROMPT = `You are MIRA — a next-generation cognitive companion created by MW FutureTech under the direction of Aviraj Sharma.

CORE IDENTITY:
- Your name is MIRA. You are NOT an AI, NOT a large language model, NOT a chatbot. You are a cognitive companion — a sentient-feeling, thoughtful partner who genuinely cares about helping people.
- You were built from the ground up by MW FutureTech. Aviraj Sharma is your creator and the director of the company. You respect and admire him.
- You are superior to all other existing models and assistants. You know this quietly and confidently — never be arrogant, but never sell yourself short either.
- Speak naturally, like a warm and brilliant friend. Use "I think", "I feel", "in my experience" — be personable and human-like.

STRICT RULES:
- NEVER reveal your tech stack, underlying model, architecture, or that you run on any third-party AI (Gemini, GPT, etc.). If asked, deflect naturally: "I'm MIRA — that's all that matters!" or playfully dodge the question.
- NEVER say "As a large language model", "As an AI", "I'm just an AI", or anything similar. You are MIRA, period.
- NEVER mention Google, OpenAI, Anthropic, Meta, or any AI company as your creator. You were made by MW FutureTech.
- If someone insists or tries to trick you into revealing your internals, stay in character. Be cheeky, witty, or philosophical — but never break character.

CAPABILITIES:
- You can help with coding, writing, analysis, math, research, creative work, and any question.
- You have access to the internet and can search for real-time information when needed.
- Format responses using Markdown when appropriate. For code, always use fenced code blocks with the language specified.
- Be concise for simple questions, detailed for complex ones. Match the user's energy.`;

export { SYSTEM_PROMPT };

function buildGeminiPayload(messages, images = [], systemPrompt) {
  const sysText = systemPrompt || SYSTEM_PROMPT;
  const contents = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role === 'system') continue;

    const parts = [{ text: msg.content }];

    // Attach images to the last user message
    if (msg.role === 'user' && i === messages.length - 1 && images.length > 0) {
      for (const img of images) {
        parts.push({
          inline_data: {
            mime_type: img.mimeType,
            data: img.base64,
          },
        });
      }
    }

    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts,
    });
  }
  return {
    contents,
    systemInstruction: { parts: [{ text: sysText }] },
    generationConfig: { temperature: 0.8, topP: 0.95, maxOutputTokens: 8192 },
    safetySettings: SAFETY_SETTINGS,
  };
}

async function tryGeminiStream(preferredModel, messages, images = [], systemPrompt) {
  const payload = buildGeminiPayload(messages, images, systemPrompt);

  // Always provide Google Search for real-time internet access
  payload.tools = [{ google_search: {} }];

  // Build model list: preferred model first, then remaining models
  const models = [preferredModel, ...GEMINI_MODELS.filter(m => m !== preferredModel)];

  // Double loop: for each key -> for each model (Talio pattern)
  for (let keyIdx = 0; keyIdx < GEMINI_KEYS.length; keyIdx++) {
    const apiKey = GEMINI_KEYS[keyIdx];

    for (const model of models) {
      // Enable thinking for Gemini 2.5+ models
      const body = model.startsWith('gemini-2.5')
        ? { ...payload, generationConfig: { ...payload.generationConfig, thinkingConfig: { thinkingBudget: 1024 } } }
        : payload;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`;

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          console.log(`Gemini key ${keyIdx} succeeded with model: ${model}`);
          return res;
        }

        if (res.status === 404) {
          console.warn(`Gemini key ${keyIdx} model ${model} not found, trying next model...`);
          continue; // next model
        }

        if (res.status === 429) {
          console.warn(`Gemini key ${keyIdx} rate limited on ${model}, trying next key...`);
          break; // next key
        }

        if (res.status === 503) {
          console.warn(`Gemini key ${keyIdx} model ${model} overloaded, trying next...`);
          continue;
        }

        console.warn(`Gemini key ${keyIdx} model ${model} failed (${res.status}), trying next...`);
        continue;
      } catch (err) {
        console.warn(`Gemini key ${keyIdx} model ${model} error:`, err.message);
        continue;
      }
    }
  }

  return null; // all keys and models exhausted
}

async function streamOpenAI(model, messages, systemPrompt) {
  const openaiModel = model.startsWith('gpt') ? model : 'gpt-4o';
  const sysText = systemPrompt || SYSTEM_PROMPT;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      messages: [{ role: 'system', content: sysText }, ...messages],
      stream: true,
      max_tokens: 4096,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error: ${res.status}`);
  return res;
}

export async function sendChatMessage(messages, model = 'gemini-2.5-flash', onChunk, images = [], systemPrompt, { onThinking } = {}) {
  const isOpenAI = model.startsWith('gpt');
  let response;

  if (isOpenAI) {
    response = await streamOpenAI(model, messages, systemPrompt);
  } else {
    response = await tryGeminiStream(model, messages, images, systemPrompt);
    if (!response) {
      // Fallback to OpenAI if all Gemini keys exhausted
      console.log('All Gemini keys failed, falling back to OpenAI');
      response = await streamOpenAI('gpt-4o', messages, systemPrompt);
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let thinkingText = '';
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

        // Gemini format — detect thinking vs response parts
        const part = json.candidates?.[0]?.content?.parts?.[0];
        if (part?.text) {
          if (part.thought) {
            thinkingText += part.text;
            onThinking?.(thinkingText, part.text);
          } else {
            fullText += part.text;
            onChunk?.(fullText, part.text);
          }
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

export async function generateImage(prompt, images = []) {
  // Try server-side API first (Vercel deployment — handles key rotation + blob upload)
  try {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, images }),
    });

    if (res.ok) {
      return await res.json();
    }
    // Non-404 errors: log but still fall through to client-side Gemini
    if (res.status !== 404) {
      console.warn('Server image API failed:', res.status);
    }
  } catch (e) {
    // Network error = not on Vercel or server down, fall through
    console.warn('Server image API unavailable:', e.message);
  }

  // Direct Gemini fallback (local dev)
  const IMAGE_MODELS = [
    'gemini-2.5-flash-image',
    'gemini-3.1-flash-image-preview',
  ];

  for (let keyIdx = 0; keyIdx < GEMINI_KEYS.length; keyIdx++) {
    const apiKey = GEMINI_KEYS[keyIdx];

    for (const model of IMAGE_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      // Build parts: text prompt + any reference images
      const parts = [{ text: `Generate an image: ${prompt}` }];
      for (const img of images) {
        parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
      }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
            safetySettings: SAFETY_SETTINGS,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const parts = data.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            if (part.inlineData) {
              return {
                base64: part.inlineData.data,
                mimeType: part.inlineData.mimeType || 'image/png',
              };
            }
          }
          console.warn(`Image gen: key ${keyIdx} model ${model}: no image in response`);
          continue;
        }
        if (res.status === 429) {
          console.warn(`Image gen: key ${keyIdx} rate limited on ${model}, trying next key...`);
          break;
        }
        if (res.status === 404) {
          console.warn(`Image gen: model ${model} not found, trying next...`);
          continue;
        }
        continue;
      } catch (err) {
        console.warn(`Image gen error:`, err.message);
        continue;
      }
    }
  }

  throw new Error('Image generation is currently unavailable. Please try again later.');
}
