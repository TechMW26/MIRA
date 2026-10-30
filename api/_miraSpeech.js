import { DEFAULT_MIRA_VOICE_ID, MIRA_VOICE_IDS, MIRA_TTS_SETTINGS, stripMiraAudioTags } from '../src/config/miraPersonality.js';

export function elevenLabsConfigured() { return Boolean(String(process.env.ELEVENLABS_API_KEY || '').trim()); }

export async function generateMiraSpeech({ input, language, voiceId, signal }) {
  if (voiceId && !MIRA_VOICE_IDS.includes(voiceId)) {
    const error = new Error('Choose a supported Mira voice.'); error.status = 400; throw error;
  }
  const key = String(process.env.ELEVENLABS_API_KEY || '').trim();
  if (!key) return null;
  const selected = voiceId || DEFAULT_MIRA_VOICE_ID;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(selected)}/stream?output_format=mp3_44100_128`, {
    method: 'POST',
    signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(55_000)]),
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: input, model_id: 'eleven_v4', apply_text_normalization: 'auto',
      ...(language ? { language_code: language } : {}), voice_settings: MIRA_TTS_SETTINGS }),
    cache: 'no-store',
  });
  // Never replace the selected voice silently after a provider failure.
  if (!response.ok || !response.body) throw new Error('Mira speech is temporarily unavailable.');
  return new Response(response.body, { status: 200, headers: {
    'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store',
    'X-Mira-Language': language || '', 'X-Mira-Voice-Provider': 'elevenlabs',
  } });
}

export { stripMiraAudioTags };
