// Pollinations.ai - completely free image generation, no API key needed
export async function generateImageFree(prompt, options = {}) {
  const { width = 1024, height = 1024, model = 'flux', seed } = options;
  const encodedPrompt = encodeURIComponent(prompt);
  const seedParam = seed ? `&seed=${seed}` : '';
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${model}&nologo=true${seedParam}`;

  // Fetch as blob to convert to base64
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

export async function generateImageFromMiraServer(prompt, images = []) {
  const res = await fetch('/api/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, images }),
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(payload?.error || payload?.detail || `Image API error: ${res.status}`);
  }

  const result = payload?.result || payload?.image || payload?.base64 || payload?.data;
  if (!result) {
    throw new Error('Image generation returned no image data.');
  }

  return result;
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
