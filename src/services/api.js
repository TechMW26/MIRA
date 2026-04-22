const SYSTEM_PROMPT = `You are MIRA — a next-generation cognitive companion created by MW FutureTech under the direction of Aviraj Sharma.`;
const PUBLIC_INFERENCE_BASE_URL = import.meta.env.VITE_INFERENCE_BASE_URL || 'http://1.193.139.71:34906';
const PUBLIC_INFERENCE_APP_TOKEN = import.meta.env.VITE_INFERENCE_APP_TOKEN || '';

export { SYSTEM_PROMPT };

async function streamViaServer(messages, images = []) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, images }),
  });

  if (!res.ok) {
    let error = `Server chat error: ${res.status}`;
    try {
      const payload = await res.json();
      if (payload?.error) error = payload.error;
    } catch {}
    throw new Error(error);
  }

  return res;
}

export async function sendChatMessage(messages, _model, onChunk, images = [], _systemPrompt, { onThinking } = {}) {
  const response = await streamViaServer(messages, images);

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
      if (!data || data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        if (json.thinking) {
          onThinking?.(json.thinking, json.thinking);
          continue;
        }
        if (json.text) {
          fullText += json.text;
          onChunk?.(fullText, json.text);
        }
      } catch {}
    }
  }

  return fullText;
}

export async function generateImage(prompt, images = []) {
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

    // Continue to direct public endpoint fallback for non-200 responses.
    console.warn('Server image route failed, trying direct public endpoint:', res.status, payload?.error || '');
  } catch (err) {
    console.warn('Server image route unavailable, trying direct public endpoint:', err.message);
  }

  if (!images.length || !images[0]?.base64) {
    throw new Error('An image is required for analysis.');
  }
  if (!PUBLIC_INFERENCE_APP_TOKEN) {
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

  const directRes = await fetch(`${PUBLIC_INFERENCE_BASE_URL}/public/analyze`, {
    method: 'POST',
    headers: { 'X-App-Token': PUBLIC_INFERENCE_APP_TOKEN },
    body: formData,
  });

  const directPayload = await directRes.json().catch(() => ({}));
  if (!directRes.ok) {
    throw new Error(directPayload?.detail || directPayload?.error || `Inference error: ${directRes.status}`);
  }

  return {
    success: true,
    inference_type: directPayload.inference_type,
    model: directPayload.model,
    result: directPayload.result,
    execution_time_ms: directPayload.execution_time_ms,
    provider: 'custom-vision-endpoint-public-direct',
  };
}