import { json, proxyError, safeVoiceError, voiceFetch } from './_voiceProxy.js';
import { guardRequest } from './_requestSecurity.js';

export const config = { maxDuration: 120 };

export async function POST(request) {
  const guarded = guardRequest(request, { limit: 30, windowMs: 60_000, key: 'voice-speech' });
  if (guarded) return guarded;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON request.' }, 400); }
  const input = String(body?.input || '').replace(/\s+/g, ' ').trim();
  if (!input) return json({ error: 'Speech input is required.' }, 400);
  if (input.length > 1800) return json({ error: 'Speech input is too long.' }, 413);

  try {
    const response = await voiceFetch('/v1/audio/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, language: String(body?.language || 'auto') }),
      signal: request.signal,
    }, { attempts: 2, timeoutMs: 100_000 });
    if (!response.ok) return proxyError(response, 'Speech generation failed.');
    return new Response(response.body, {
      status: 200,
      headers: {
        'Content-Type': response.headers.get('content-type') || 'audio/wav',
        'Cache-Control': 'no-store',
        'X-Mira-Language': response.headers.get('x-mira-language') || '',
        'X-Mira-Voice-Provider': response.headers.get('x-mira-voice-provider') || '',
      },
    });
  } catch (error) {
    return json({ error: safeVoiceError(error, 'Speech generation is temporarily unavailable.') }, 503);
  }
}
