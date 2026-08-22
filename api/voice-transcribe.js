import { json, proxyError, safeVoiceError, voiceFetch } from './_voiceProxy.js';
import { guardRequest } from './_requestSecurity.js';

export const config = { maxDuration: 120 };

export async function POST(request) {
  const guarded = guardRequest(request, { limit: 30, windowMs: 60_000, key: 'voice-transcribe' });
  if (guarded) return guarded;
  let incoming;
  try { incoming = await request.formData(); } catch { return json({ error: 'A voice recording is required.' }, 400); }
  const file = incoming.get('file');
  if (!(file instanceof Blob) || !file.size) return json({ error: 'A voice recording is required.' }, 400);
  if (file.size > 8 * 1024 * 1024) return json({ error: 'Voice recording is too large.' }, 413);

  const form = new FormData();
  form.append('file', file, file.name || 'voice.webm');
  const language = String(incoming.get('language') || '').toLowerCase();
  if (language === 'hi') form.append('language', 'hi');
  try {
    const response = await voiceFetch('/v1/audio/transcriptions', {
      method: 'POST',
      body: form,
      signal: request.signal,
    }, { attempts: 2, timeoutMs: 100_000 });
    if (!response.ok) return proxyError(response, 'Speech recognition failed.');
    return new Response(response.body, {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return json({ error: safeVoiceError(error, 'Speech recognition is temporarily unavailable.') }, 503);
  }
}
