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

export function detectImageRequest(message) {
  const lower = message.toLowerCase();
  return /\b(generate|create|draw|make|paint|design|render|show me|give me)\b.*\b(image|picture|photo|illustration|artwork|logo|icon|banner|poster|wallpaper|sketch|drawing)\b/i.test(lower)
    || /\b(image|picture|photo|illustration|artwork|logo)\b.*\b(of|showing|depicting|with)\b/i.test(lower);
}
