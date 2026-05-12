import INFERENCE_ENDPOINTS from '../config/endpoints';

// Pollinations.ai - completely free image generation, no API key needed
export async function generateImageFree(prompt, options = {}) {
  const { width = 1024, height = 1024, model = 'flux', seed } = options;
  const encodedPrompt = encodeURIComponent(prompt);
  const seedParam = seed ? `&seed=${seed}` : '';
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${model}&nologo=true${seedParam}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image generation failed: ${res.status}`);
  const blob = await res.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function normalizeToDataUrl({ directDataUrl, maybeBase64, mime, defaultMime }) {
  const trimmed = typeof directDataUrl === 'string' ? directDataUrl.trim() : '';
  if (trimmed.startsWith('data:')) return trimmed;

  const base64 = typeof maybeBase64 === 'string' ? maybeBase64.trim() : '';
  if (!base64) return '';

  if (base64.startsWith('data:')) return base64;

  const useMime = mime || defaultMime || 'image/png';
  const dataUrl = `data:${useMime};base64,${base64}`;
  return dataUrl;
}

/**
 * DreamShaper image server integration:
 * - POST http://142.127.68.223:15069/generate
 * - multipart/form-data fields: prompt, negative_prompt?, steps?, guidance_scale?, seed?
 * - header: X-API-KEY
 *
 * Contract you observed:
 * { success, prompt, image_base64, generation_time_ms }
 */
export async function generateImageFromMiraServer(
  prompt,
  {
    negative_prompt = 'low quality, blurry, distorted',
    steps = 10,
    guidance_scale = 7.5,
    seed = -1,
  } = {},
) {
  if (!prompt?.trim()) throw new Error('prompt is required');

  const imageBaseUrl =
    import.meta.env.VITE_IMAGE_API_BASE_URL || 'http://142.127.68.223:15069';

  const apiKey =
    import.meta.env.VITE_IMAGE_API_KEY ||
    INFERENCE_ENDPOINTS?.protected?.apiKey ||
    'PRO_SAFETY_TOKEN_2026';

  const url = `${imageBaseUrl}/generate`;

  const form = new FormData();
  form.append('prompt', prompt);
  if (negative_prompt !== undefined && negative_prompt !== null) form.append('negative_prompt', String(negative_prompt));
  if (steps !== undefined && steps !== null) form.append('steps', String(steps));
  if (guidance_scale !== undefined && guidance_scale !== null) form.append('guidance_scale', String(guidance_scale));
  if (seed !== undefined && seed !== null) form.append('seed', String(seed));

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
    },
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const ct = res.headers.get('content-type') || '';
    throw new Error(
      ['Mira image generation failed', `status=${res.status}`, `content-type=${ct}`, text ? `body=${text.slice(0, 500)}` : 'body=<empty>']
        .join(' | '),
    );
  }

  const contentType = res.headers.get('content-type') || '';

  // JSON response
  if (contentType.includes('application/json')) {
    const data = await res.json();

    const directDataUrl =
      data?.imageUrl ||
      data?.url ||
      data?.image_url ||
      data?.dataUrl ||
      data?.data_url ||
      data?.imageDataUrl;

    const maybeBase64 =
      data?.image_base64 ||
      data?.imageBase64 ||
      data?.base64 ||
      data?.image ||
      data?.data?.image_base64 ||
      data?.data?.imageBase64 ||
      data?.data?.base64;

    // server likely doesn't return mime; infer from data URL/content type if available
    const inferredMime =
      data?.mimeType ||
      data?.mime ||
      data?.contentType ||
      data?.fileType ||
      (typeof contentType === 'string' && contentType.includes('png') ? 'image/png' : undefined);

    const dataUrl = normalizeToDataUrl({
      directDataUrl,
      maybeBase64,
      mime: inferredMime,
      defaultMime: 'image/png',
    });

    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      const keys = data && typeof data === 'object' ? Object.keys(data) : [];
      throw new Error(`Unexpected JSON response shape. Keys: ${keys.join(', ')}`);
    }

    return dataUrl;
  }

  // Non-JSON: treat as raw image bytes
  const blob = await res.blob();
  return blobToDataUrl(blob);
}

export function detectImageRequest(message) {
  const lower = message.toLowerCase();
  return (
    (/\b(generate|create|draw|make|paint|design|render|show me|give me)\b.*\b(image|picture|photo|illustration|artwork|logo|icon|banner|poster|wallpaper|sketch|drawing)\b/i.test(
      lower,
    )) ||
    (/\b(image|picture|photo|illustration|artwork|logo)\b.*\b(of|showing|depicting|with)\b/i.test(lower))
  );
}
