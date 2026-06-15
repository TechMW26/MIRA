import { runChatCompletion } from './api.js';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function normalizeImage(image, mimeType) {
  if (!image) throw new Error('Image is required for image analysis');
  if (typeof image === 'string') {
    return { base64: image.includes(',') ? image.split(',')[1] : image, mimeType };
  }
  if (image instanceof File || image instanceof Blob) {
    return {
      base64: await fileToBase64(image),
      mimeType: image.type || mimeType,
    };
  }
  if (image.base64 || image.data || image.url) {
    const raw = image.base64 || image.data || image.url;
    return {
      base64: typeof raw === 'string' && raw.includes(',') ? raw.split(',')[1] : raw,
      mimeType: image.mimeType || image.type || mimeType,
    };
  }
  throw new Error('Unsupported image input');
}

export async function analyzeImage(prompt, image, mimeType = 'image/jpeg') {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt must be a non-empty string');
  }

  const normalizedImage = await normalizeImage(image, mimeType);
  return runChatCompletion({
    model: 'vision',
    messages: [{ role: 'user', content: prompt }],
    images: [normalizedImage],
    think: false,
  });
}

export async function analyzeImageBatch(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('Items must be a non-empty array');
  }

  const results = await Promise.allSettled(
    items.map(({ prompt, image, mimeType = 'image/jpeg' }) => analyzeImage(prompt, image, mimeType)),
  );

  return results.map((result) => ({
    ok: result.status === 'fulfilled',
    data: result.value,
    error: result.reason?.message,
  }));
}