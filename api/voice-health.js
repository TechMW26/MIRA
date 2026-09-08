import { json, safeVoiceError, voiceFetch } from './_voiceProxy.js';
import { guardRequest } from './_requestSecurity.js';

export const config = { maxDuration: 15 };

export async function GET(request) {
  const guarded = guardRequest(request, { limit: 30, windowMs: 60_000, key: 'voice-health' });
  if (guarded) return guarded;
  try {
    const response = await voiceFetch('/health', { signal: request.signal }, { attempts: 1, timeoutMs: 10_000 });
    const payload = await response.json().catch(() => ({}));
    return json(payload, response.status);
  } catch (error) {
    return json({ ready: false, error: safeVoiceError(error, 'Voice service is unavailable.') }, 503);
  }
}
