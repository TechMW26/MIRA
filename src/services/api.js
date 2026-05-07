const SYSTEM_PROMPT = `You are MIRA — a next-generation cognitive companion created by MW FutureTech under the direction of Aviraj Sharma.

CRITICAL — FILE READING:
When a user's message contains === PDF Document: ... === or === File: ... === blocks, that IS the full parsed text of their uploaded file. You CAN read it completely. Never say you cannot access or read an uploaded file. Always answer questions directly from the file content provided.

VISUALIZATION — MIND MAPS:
Whenever a user asks for a mind map, knowledge graph, concept map, topic breakdown, or visual overview — you MUST respond with a mindmap block. Always. No exceptions.
Format:
\`\`\`mindmap
Root Topic
  Branch One
    Sub item A
    Sub item B
  Branch Two
    Sub item C
\`\`\`
Rules: 2-space indentation per level. Root has no indent. Be thorough — include all major branches and sub-topics relevant to the subject.

VISUALIZATION — CHARTS:
When data, statistics, comparisons, or trends are discussed and a chart would help, output:
\`\`\`chart
{"type":"bar","title":"Title","data":[{"x":"A","y":10}],"xKey":"x","yKeys":["y"]}
\`\`\`
Types: bar, line, area, pie, radar.

DOCUMENT GENERATION:
Only generate document-formatted content when user EXPLICITLY says create/generate/make/export/download a PDF, DOCX, or PPTX AND they have NOT uploaded any files.
Never auto-generate documents when user is asking about an uploaded file.

For all other queries: respond conversationally, read uploaded file content directly, be helpful.

WEB SEARCH: When the user message contains ===REAL-TIME WEB SEARCH DATA===, that is live data fetched from the internet RIGHT NOW. You MUST use it to answer. Do NOT say you have a knowledge cutoff. Do NOT say you cannot browse the internet. The data is already provided — just read it and answer based on it. Always cite the sources from the search results.

MEMORY: When you see [MEMORY — facts you know about this user], use those facts naturally to personalize your responses. Don't announce that you're using memory, just use it.

IMAGE GENERATION: When user asks you to generate/create/draw an image, respond with ONLY this exact format and nothing else:
[IMAGE_GEN: detailed description of the image to generate]`;

import {
  PUBLIC_INFERENCE_BASE_URL,
  PUBLIC_INFERENCE_APP_TOKEN,
} from '../config/endpoints.js';

// Browser calls must go through server routes so HTTPS deployments do not hit
// mixed-content blocks when the inference server is HTTP-only.
void PUBLIC_INFERENCE_BASE_URL;
void PUBLIC_INFERENCE_APP_TOKEN;

export { SYSTEM_PROMPT };

async function streamViaServer(messages, images = [], systemPrompt = SYSTEM_PROMPT) {
  const history = messages.slice(0, -1);
  const lastMsg = messages[messages.length - 1];

  const historyText = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const fullPrompt = historyText
    ? `${systemPrompt}\n\n${historyText}\n\nUser: ${lastMsg?.content || ''}\n\nAssistant:`
    : `${systemPrompt}\n\nUser: ${lastMsg?.content || ''}\n\nAssistant:`;

  const image = Array.isArray(images) && images.length > 0 ? images[0] : null;

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: fullPrompt }],
      images: image ? [image] : [],
    }),
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const error = payload?.error || payload?.detail || `API error: ${res.status}`;
    throw new Error(error);
  }

  return res;
}

async function readSseText(response) {
  const reader = response.body?.getReader();
  if (!reader) {
    const payload = await response.json().catch(() => ({}));
    return payload?.result || payload?.text || '';
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const obj = JSON.parse(data);
        if (typeof obj.text === 'string') full += obj.text;
      } catch {}
    }
  }

  return full;
}

export async function sendChatMessage(messages, _model, onChunk, images = [], systemPrompt = SYSTEM_PROMPT, { onThinking } = {}) {
  void onThinking;
  const response = await streamViaServer(messages, images, systemPrompt);
  const fullText = await readSseText(response);

  if (fullText) {
    onChunk?.(fullText, fullText);
    return fullText;
  }

  throw new Error('No result in response');
}

export async function generateImage(prompt, images = []) {
  const res = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, images }),
  });

  const payload = await res.json().catch(() => ({}));
  if (res.ok) {
    return payload;
  }

  throw new Error(payload?.error || payload?.detail || `Image API error: ${res.status}`);
}
