import { put } from '@vercel/blob';

export const config = { maxDuration: 60 };

const OPENAI_KEY = process.env.OPENAI_API_KEY;

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY_4,
  process.env.GEMINI_API_KEY_5,
  process.env.GEMINI_API_KEY_6,
  process.env.GEMINI_API_KEY_7,
].filter(Boolean);

const IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
];

async function uploadToBlob(base64Data, mimeType) {
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const filename = `mira-images/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const buffer = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

  const blob = await put(filename, buffer, {
    access: 'public',
    contentType: mimeType,
  });

  return blob.url;
}

async function generateWithDalle(prompt) {
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
      response_format: 'b64_json',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `DALL-E error: ${res.status}`);
  }

  const data = await res.json();
  const b64 = data.data[0].b64_json;
  const url = await uploadToBlob(b64, 'image/png');

  return {
    url,
    revised_prompt: data.data[0].revised_prompt,
    provider: 'dall-e-3',
  };
}

async function generateWithGemini(prompt, images = []) {
  for (let keyIdx = 0; keyIdx < GEMINI_KEYS.length; keyIdx++) {
    const apiKey = GEMINI_KEYS[keyIdx];

    for (const model of IMAGE_MODELS) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      // Build parts: text prompt + any reference images
      const parts = [{ text: `Generate an image: ${prompt}` }];
      for (const img of images) {
        if (img.base64 && img.mimeType) {
          parts.push({ inline_data: { mime_type: img.mimeType, data: img.base64 } });
        }
      }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
          }),
        });

        if (res.status === 429) {
          console.warn(`Image gen: key ${keyIdx} rate limited on ${model}, trying next key...`);
          break; // next key
        }

        if (res.status === 404) {
          console.warn(`Image gen: model ${model} not found, trying next model...`);
          continue; // next model
        }

        if (!res.ok) {
          console.warn(`Image gen: key ${keyIdx} model ${model} failed (${res.status})`);
          continue;
        }

        const data = await res.json();
        const parts = data.candidates?.[0]?.content?.parts || [];

        for (const part of parts) {
          if (part.inlineData) {
            const blobUrl = await uploadToBlob(part.inlineData.data, part.inlineData.mimeType || 'image/png');
            return {
              url: blobUrl,
              mimeType: part.inlineData.mimeType,
              provider: 'gemini-imagen',
            };
          }
        }

        console.warn(`Image gen: key ${keyIdx} model ${model}: no image in response`);
        continue;
      } catch (err) {
        console.warn(`Image gen: key ${keyIdx} model ${model} error:`, err.message);
        continue;
      }
    }
  }

  return null;
}

export async function POST(req) {
  try {
    const { prompt, images } = await req.json();

    if (!prompt) {
      return new Response(JSON.stringify({ error: 'prompt is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Try Gemini image generation first (free) — pass reference images if any
    const geminiResult = await generateWithGemini(prompt, images || []);
    if (geminiResult) {
      return new Response(JSON.stringify(geminiResult), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Fallback to DALL-E
    if (OPENAI_KEY) {
      try {
        const result = await generateWithDalle(prompt);
        return new Response(JSON.stringify(result), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        console.error('DALL-E failed:', err.message);
      }
    }

    return new Response(
      JSON.stringify({ error: 'All image generation providers failed. Please try again later.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('Image API error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
