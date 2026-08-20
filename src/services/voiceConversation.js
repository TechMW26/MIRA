import { stripBrowserControl } from './browserControl.js';
import { stripToolControl } from './toolControl.js';
import { stripWebSearchControl } from './webSearchControl.js';

const DEVANAGARI = /[\u0900-\u097f]/;
const INVISIBLE_UNICODE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const SUPPORTED_VOICE_LETTER = /[\p{Script=Latin}\p{Script=Devanagari}]/u;
const SPEECH_CHARACTER = /[\p{L}\p{M}\p{N}]/u;
const ANY_LETTER = /[\p{L}\p{M}]/u;
const VOICE_HEALTH_TTL_MS = 30_000;
let cachedVoiceHealth = null;
let cachedVoiceHealthAt = 0;

export function detectVoiceLanguage(text = '', hintedLanguage = '') {
  if (String(hintedLanguage).toLowerCase().startsWith('hi') || DEVANAGARI.test(String(text))) return 'hi';
  return 'en';
}

export function normalizeVoiceTranscript(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .replace(INVISIBLE_UNICODE, '')
    .replace(
      /^(\s*(?:hi|hey|hello|namaste)[,!]?\s+)(?:m\.?\s*r\.?\s*w|mirror|meera)(?=[\s.!?,]|$)/i,
      '$1Mira',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

export function assessVoiceTranscript(value = '') {
  const text = normalizeVoiceTranscript(value);
  if (!text) return { usable: false, text: '', reason: 'empty' };

  const significant = Array.from(text).filter((character) => SPEECH_CHARACTER.test(character));
  if (!significant.length) return { usable: false, text: '', reason: 'no-speech-content' };

  const counts = new Map();
  significant.forEach((character) => counts.set(character, (counts.get(character) || 0) + 1));
  const dominantCount = Math.max(...counts.values());
  const uniqueRatio = counts.size / significant.length;
  if (
    significant.length >= 12
    && (dominantCount / significant.length > 0.5 || uniqueRatio < 0.12)
  ) {
    return { usable: false, text: '', reason: 'repetitive-noise' };
  }

  const letters = significant.filter((character) => ANY_LETTER.test(character));
  const unsupportedLetters = letters.filter((character) => !SUPPORTED_VOICE_LETTER.test(character));
  if (letters.length >= 6 && unsupportedLetters.length / letters.length > 0.4) {
    return { usable: false, text: '', reason: 'unsupported-script-noise' };
  }

  const longestToken = text.split(/\s+/).reduce((longest, token) => Math.max(longest, token.length), 0);
  if (significant.length >= 24 && longestToken >= 24 && uniqueRatio < 0.3) {
    return { usable: false, text: '', reason: 'garbled-token' };
  }

  return { usable: true, text, reason: '' };
}

export function updateVoiceInterruptionGate(
  startedAt,
  rms,
  now,
  { threshold = 0.055, holdMs = 120 } = {},
) {
  if (!Number.isFinite(rms) || rms < threshold) {
    return { startedAt: 0, triggered: false };
  }
  const nextStartedAt = startedAt || now;
  return {
    startedAt: nextStartedAt,
    triggered: now - nextStartedAt >= holdMs,
  };
}

export const NEW_VOICE_CONVERSATION = '__mira_new_voice_conversation__';

export function resolveVoiceConversationBinding(boundConversationId, nextConversationId) {
  const bound = String(boundConversationId || '');
  const next = String(nextConversationId || '');
  if (!bound) return { action: 'close', conversationId: '' };
  if (bound === NEW_VOICE_CONVERSATION && next) {
    return { action: 'bind', conversationId: next };
  }
  if (bound === NEW_VOICE_CONVERSATION || bound === next) {
    return { action: 'keep', conversationId: bound };
  }
  return { action: 'close', conversationId: bound };
}

export function getSpeakableIncrement(previousValue = '', nextValue = '', final = false) {
  const previous = sanitizeSpeechText(previousValue);
  const next = sanitizeSpeechText(nextValue);
  if (!next || (previous && !next.startsWith(previous))) return { text: '', consumed: previous };
  const pending = next.slice(previous.length).trimStart();
  if (!pending) return { text: '', consumed: previous };
  if (final) return { text: pending, consumed: next };

  let boundary = -1;
  const matcher = /[.!?।,;:](?:\s|$)/g;
  let match;
  while ((match = matcher.exec(pending))) boundary = matcher.lastIndex;
  if (boundary < 0 && pending.length >= 64) {
    const candidate = pending.slice(0, 76);
    boundary = candidate.lastIndexOf(' ');
    if (boundary < 42) boundary = -1;
  }
  if (boundary < 0) return { text: '', consumed: previous };
  const text = pending.slice(0, boundary).trim();
  return {
    text,
    consumed: sanitizeSpeechText(`${previous} ${text}`),
  };
}

export function sanitizeSpeechText(value = '') {
  return sanitizeVoiceOutput(value)
    .replace(/^\s*[•-]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sanitizeVoiceOutput(value = '') {
  const withoutControls = stripWebSearchControl(
    stripBrowserControl(stripToolControl(String(value || ''))),
  );
  return withoutControls
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .replace(/```[\s\S]*?```/g, ' Code example omitted. ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\s+(?=\d{1,2}[.)]\s+[A-Z\u0900-\u097f])/g, '\n')
    .replace(/[>*_~]/g, '')
    .replace(/\s*\[(?:\d+(?:\s*,\s*\d+)*)\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function splitSpeechText(value = '', maxChars = 92) {
  const text = sanitizeSpeechText(value);
  if (!text) return [];
  const sentences = text.match(/[^.!?।]+[.!?।]+|[^.!?।]+$/g) || [text];
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    const cleanSentence = sentence.trim();
    const next = `${current} ${cleanSentence}`.trim();
    if (next.length <= maxChars) {
      current = next;
      continue;
    }
    if (current) chunks.push(current);
    if (cleanSentence.length <= maxChars) {
      current = cleanSentence;
      continue;
    }
    const words = cleanSentence.split(/\s+/);
    current = '';
    for (const word of words) {
      const wordNext = `${current} ${word}`.trim();
      if (wordNext.length > maxChars && current) {
        chunks.push(current);
        current = word;
      } else {
        current = wordNext;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function apiError(response, fallback) {
  const payload = await response.json().catch(() => ({}));
  return new Error(payload?.error || fallback);
}

export async function transcribeVoice(blob, signal, { language = '' } = {}) {
  const form = new FormData();
  const extension = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
  form.append('file', blob, `mira-voice.${extension}`);
  if (language) form.append('language', language);
  const response = await fetch('/api/voice-transcribe', { method: 'POST', body: form, signal });
  if (!response.ok) throw await apiError(response, 'MIRA could not understand that recording.');
  return response.json();
}

export async function synthesizeVoice(input, language, signal) {
  const response = await fetch('/api/voice-speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, language }),
    signal,
  });
  if (!response.ok) throw await apiError(response, 'MIRA could not generate speech.');
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
    throw new Error('The voice service returned an invalid audio response.');
  }
  const audio = await response.blob();
  if (!audio.size) throw new Error('The voice service returned empty audio.');
  return audio;
}

export async function getVoiceHealth(signal) {
  if (cachedVoiceHealth && Date.now() - cachedVoiceHealthAt < VOICE_HEALTH_TTL_MS) {
    return cachedVoiceHealth;
  }
  const response = await fetch('/api/voice-health', { signal, cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  const health = { ...payload, ready: response.ok && payload.ready !== false };
  if (health.ready) {
    cachedVoiceHealth = health;
    cachedVoiceHealthAt = Date.now();
  }
  return health;
}
