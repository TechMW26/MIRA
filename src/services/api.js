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

<<<<<<< Updated upstream
// NOTE: We never call the upstream inference endpoint directly from the
// browser anymore. The public endpoint is HTTP-only and would be blocked as
// "mixed content" on HTTPS deployments. All chat/image traffic is proxied
// through `/api/chat` and `/api/image` (server-side fetch is allowed).
// These imports are kept as references in case server-rendered code paths
// need them; they are intentionally unused at runtime.
void PUBLIC_INFERENCE_BASE_URL;
void PUBLIC_INFERENCE_APP_TOKEN;

export { SYSTEM_PROMPT };

=======
<<<<<<< HEAD
// Fallback to environment variables if config not available
const INFERENCE_BASE_URL = PUBLIC_INFERENCE_BASE_URL || import.meta.env.VITE_INFERENCE_BASE_URL || 'http://194.68.245.162:22159';
const INFERENCE_APP_TOKEN = PUBLIC_INFERENCE_APP_TOKEN || import.meta.env.VITE_INFERENCE_APP_TOKEN || 'f6d30c6778656de0ed82045a28ab2ff3';

export { SYSTEM_PROMPT };

function buildFileFromImage(image) {
  const mimeType = image?.mimeType || 'image/jpeg';
  const base64 = image?.base64 || '';
  if (!base64) return null;

  const sanitized = base64.includes(',') ? base64.split(',')[1] : base64;
  const bytes = Uint8Array.from(atob(sanitized), (c) => c.charCodeAt(0));
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const blob = new Blob([bytes], { type: mimeType });

  return { blob, filename: `upload.${ext}` };
}

=======
// NOTE: We never call the upstream inference endpoint directly from the
// browser anymore. The public endpoint is HTTP-only and would be blocked as
// "mixed content" on HTTPS deployments. All chat/image traffic is proxied
// through `/api/chat` and `/api/image` (server-side fetch is allowed).
// These imports are kept as references in case server-rendered code paths
// need them; they are intentionally unused at runtime.
void PUBLIC_INFERENCE_BASE_URL;
void PUBLIC_INFERENCE_APP_TOKEN;

export { SYSTEM_PROMPT };

>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
async function streamViaServer(messages, images = [], systemPrompt = SYSTEM_PROMPT) {
  // Separate history from the last user message
  const history = messages.slice(0, -1);
  const lastMsg = messages[messages.length - 1];

  // Build conversation history (without last message)
  const historyText = history
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  // Last user message goes at the very end so the model sees it last
  const fullPrompt = historyText
    ? `${systemPrompt}\n\n${historyText}\n\nUser: ${lastMsg?.content || ''}\n\nAssistant:`
    : `${systemPrompt}\n\nUser: ${lastMsg?.content || ''}\n\nAssistant:`;

<<<<<<< Updated upstream
=======
<<<<<<< HEAD
  const image = Array.isArray(images) && images.length > 0 ? images[0] : null;
  const file = buildFileFromImage(image);

  const formData = new FormData();
  formData.append('prompt', fullPrompt);
  if (file) {
    formData.append('file', file.blob, file.filename);
  }

  const res = await fetch(`${INFERENCE_BASE_URL}/public/analyze`, {
    method: 'POST',
    headers: { 'X-App-Token': INFERENCE_APP_TOKEN },
    body: formData,
=======
>>>>>>> Stashed changes
  // Always route through our server proxy `/api/chat`. This is required because
  // the upstream inference endpoint is HTTP-only and browsers block mixed
  // content on HTTPS pages (e.g. itsmira.cloud).
  const image = Array.isArray(images) && images.length > 0 ? images[0] : null;

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: fullPrompt }],
      images: image ? [image] : [],
    }),
<<<<<<< Updated upstream
=======
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
<<<<<<< Updated upstream
    const error = payload?.error || payload?.detail || `API error: ${res.status}`;
=======
<<<<<<< HEAD
    const error = payload?.detail || payload?.error || `API error: ${res.status}`;
=======
    const error = payload?.error || payload?.detail || `API error: ${res.status}`;
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
    throw new Error(error);
  }

  return res;
}

<<<<<<< Updated upstream
=======
<<<<<<< HEAD
export async function sendChatMessage(messages, _model, onChunk, images = [], systemPrompt = SYSTEM_PROMPT, { onThinking } = {}) {
  const response = await streamViaServer(messages, images, systemPrompt);

  const payload = await response.json();
  
  if (payload.result) {
    const fullText = payload.result;
    onChunk?.(fullText, fullText);
    return fullText;
=======
>>>>>>> Stashed changes
async function readSseText(response) {
  const reader = response.body?.getReader();
  if (!reader) {
    // Not an SSE stream — fall back to JSON shape (legacy)
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
      } catch { /* ignore malformed line */ }
    }
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
  }
  return full;
}

<<<<<<< HEAD
=======
export async function sendChatMessage(messages, _model, onChunk, images = [], systemPrompt = SYSTEM_PROMPT, { onThinking } = {}) {
  const response = await streamViaServer(messages, images, systemPrompt);
  const fullText = await readSseText(response);

  if (fullText) {
    onChunk?.(fullText, fullText);
    return fullText;
  }
  return full;
}

<<<<<<< Updated upstream
export async function sendChatMessage(messages, _model, onChunk, images = [], systemPrompt = SYSTEM_PROMPT, { onThinking } = {}) {
  const response = await streamViaServer(messages, images, systemPrompt);
  const fullText = await readSseText(response);

  if (fullText) {
    onChunk?.(fullText, fullText);
    return fullText;
  }

=======
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
  throw new Error('No result in response');
}

export async function generateImage(prompt, images = []) {
<<<<<<< Updated upstream
  const res = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, images }),
=======
<<<<<<< HEAD
  try {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, images }),
    });

    const payload = await res.json().catch(() => ({}));
    if (res.ok) {
      return payload;
    }

    console.warn('Server image route failed, trying direct public endpoint:', res.status, payload?.error || '');
  } catch (err) {
    console.warn('Server image route unavailable, trying direct public endpoint:', err.message);
  }

  if (!images.length || !images[0]?.base64) {
    throw new Error('An image is required for analysis.');
  }
  if (!INFERENCE_APP_TOKEN) {
    throw new Error('Public inference token is not configured for direct fallback.');
  }

  const image = images[0];
  const mimeType = image.mimeType || 'image/jpeg';
  const bytes = Uint8Array.from(atob(image.base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: mimeType });
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';

  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('file', blob, `upload.${ext}`);

  const directRes = await fetch(`${INFERENCE_BASE_URL}/public/analyze`, {
    method: 'POST',
    headers: { 'X-App-Token': INFERENCE_APP_TOKEN },
    body: formData,
=======
  const res = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, images }),
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
  });

  const payload = await res.json().catch(() => ({}));
  if (res.ok) {
    return payload;
  }

<<<<<<< Updated upstream
  throw new Error(payload?.error || payload?.detail || `Image API error: ${res.status}`);
=======
<<<<<<< HEAD
  return {
    success: true,
    inference_type: directPayload.inference_type,
    model: directPayload.model,
    result: directPayload.result,
    execution_time_ms: directPayload.execution_time_ms,
    provider: 'custom-vision-endpoint-public-direct',
  };
=======
  throw new Error(payload?.error || payload?.detail || `Image API error: ${res.status}`);
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
}
