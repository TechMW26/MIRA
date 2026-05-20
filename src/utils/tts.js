export function cleanSpeechText(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, 'code block')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[>#*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const VOICE_STORAGE_KEY = 'mira_tts_voice_id';

export function getPreferredVoiceId() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(VOICE_STORAGE_KEY) || '';
}

export function setPreferredVoiceId(voiceId = '') {
  if (typeof window === 'undefined') return;
  const value = String(voiceId || '');
  if (value) window.localStorage.setItem(VOICE_STORAGE_KEY, value);
  else window.localStorage.removeItem(VOICE_STORAGE_KEY);
}

export function getVoiceKey(voice) {
  return `${voice?.name || ''}::${voice?.lang || ''}`;
}

export function formatVoiceLabel(voice) {
  if (!voice) return 'Default voice';
  const bits = [voice.name, voice.lang ? `(${voice.lang})` : ''];
  return bits.filter(Boolean).join(' ').trim();
}

export function findVoiceById(voices = [], voiceId = '') {
  const list = Array.isArray(voices) ? voices.filter(Boolean) : [];
  const target = String(voiceId || '').trim();
  if (!target) return null;
  return list.find((voice) => getVoiceKey(voice) === target) || null;
}

function scoreVoice(voice) {
  const name = String(voice?.name || '').toLowerCase();
  const lang = String(voice?.lang || '').toLowerCase();
  let score = 0;

  if (lang.startsWith('en')) score += 10;
  if (voice?.default) score += 4;
  if (voice?.localService) score += 2;

  const preferredNames = [
    'samantha', 'ava', 'allison', 'karen', 'serena', 'daniel', 'alex', 'fred',
    'google', 'microsoft', 'natural', 'enhanced', 'premium', 'neural',
  ];
  for (const token of preferredNames) {
    if (name.includes(token)) score += 3;
  }

  const avoidedNames = ['bad', 'test', 'sample', 'speech services by google'];
  for (const token of avoidedNames) {
    if (name.includes(token)) score -= 2;
  }

  return score;
}

export function pickBestVoice(voices = []) {
  const list = Array.isArray(voices) ? voices.filter(Boolean) : [];
  if (!list.length) return null;
  return [...list].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0] || null;
}

export function pickPreferredVoice(voices = []) {
  const preferred = findVoiceById(voices, getPreferredVoiceId());
  return preferred || pickBestVoice(voices);
}

export function getExpressiveSpeechOptions(text = '') {
  const content = String(text || '');
  const questionMarks = (content.match(/\?/g) || []).length;
  const exclamationMarks = (content.match(/!/g) || []).length;
  const sentenceCount = content.split(/[.!?]+/).filter((part) => part.trim()).length || 1;
  const wordCount = content.split(/\s+/).filter(Boolean).length || 1;

  const pace = wordCount > 120 ? 0.92 : wordCount > 60 ? 0.97 : 1;
  const excitement = Math.min(0.15, exclamationMarks * 0.03 + questionMarks * 0.02);
  const calmness = Math.min(0.08, sentenceCount > 8 ? 0.05 : 0);

  return {
    rate: Math.max(0.85, Math.min(1.08, pace + excitement - calmness)),
    pitch: Math.max(0.9, Math.min(1.15, 1 + excitement - calmness / 2)),
    volume: 1,
  };
}

export function createSpeechUtterance(text, voice = null) {
  const cleaned = cleanSpeechText(text);
  const utterance = new SpeechSynthesisUtterance(cleaned);
  const options = getExpressiveSpeechOptions(cleaned);
  utterance.rate = options.rate;
  utterance.pitch = options.pitch;
  utterance.volume = options.volume;
  if (voice) utterance.voice = voice;
  return utterance;
}