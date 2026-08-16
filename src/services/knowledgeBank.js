// ──────────────────────────────────────────────────────────────
// Knowledge Bank — token-efficient user context system
// ──────────────────────────────────────────────────────────────
// Stores user facts locally and only injects them into the model
// when actually needed (vs. blasting context with every prompt).
//
// Heuristic-based: scans the user message for personal-reference
// triggers (my, I am, remember, prefer, etc.) and decides whether
// to send full context, minimal context, or no context at all.

const STORAGE_KEY = 'mira_knowledge_bank';
const LEARNED_FACTS_KEY = 'mira_learned_facts';
const RESPONSE_PREFERENCES_KEY = 'mira_response_preferences_v1';

// ── Storage helpers ──
function loadStore(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStore(key, data) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

// ── Public API for facts the model learns about the user ──
export function getLearnedFacts() {
  return loadStore(LEARNED_FACTS_KEY);
}

export function addLearnedFact(key, value) {
  if (!key || value === undefined || value === null) return;
  const facts = getLearnedFacts();
  facts[key] = { value: String(value).slice(0, 240), at: Date.now() };
  saveStore(LEARNED_FACTS_KEY, facts);
}

export function clearLearnedFacts() {
  saveStore(LEARNED_FACTS_KEY, {});
}

function responsePreferencesStorageKey(scope = '') {
  const safeScope = String(scope || 'local').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'local';
  return `${RESPONSE_PREFERENCES_KEY}:${safeScope}`;
}

export function getLearnedResponsePreferences(scope = '') {
  return loadStore(responsePreferencesStorageKey(scope));
}

export function clearLearnedResponsePreferences(scope = '') {
  saveStore(responsePreferencesStorageKey(scope), {});
}

const TRANSIENT_STYLE_RE = /\b(?:for|in)\s+(?:this|the current)\s+(?:answer|message|response|reply)|\bjust\s+this\s+(?:once|time)\b/i;

export function learnResponsePreferences(message = '', { scope = '' } = {}) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  if (!text || TRANSIENT_STYLE_RE.test(text)) return {};

  const updates = {};
  if (/\b(?:be|write|answer|respond|keep (?:it|your answers?))\s+(?:more\s+)?(?:concise|brief|short(?:er)?)\b|\b(?:too verbose|less verbose|no fluff)\b/i.test(text)) updates.length = 'concise';
  if (/\b(?:be|write|answer|respond|make (?:it|your answers?))\s+(?:more\s+)?(?:detailed|thorough|in[- ]depth)\b|\bmore detail\b/i.test(text)) updates.length = 'detailed';
  if (/\b(?:use|prefer)\s+(?:bullet(?:ed)?\s+(?:points?|lists?)|bullets)\b/i.test(text)) updates.format = 'bullets';
  if (/\b(?:do not|don't|stop|avoid)\s+(?:using\s+)?(?:bullet(?:ed)?\s+(?:points?|lists?)|bullets)\b/i.test(text)) updates.format = 'paragraphs';
  if (/\b(?:use|prefer)\s+(?:simple|plain)\s+(?:language|words)\b|\b(?:less|avoid)\s+jargon\b|\bexplain (?:it|things?) simply\b/i.test(text)) updates.language = 'plain';
  if (/\b(?:be|sound|write)\s+(?:more\s+)?casual\b|\bconversational tone\b/i.test(text)) updates.tone = 'casual';
  if (/\b(?:be|sound|write)\s+(?:more\s+)?formal\b|\bprofessional tone\b/i.test(text)) updates.tone = 'formal';
  if (/\b(?:include|use|add)\s+(?:more\s+)?(?:code\s+)?examples?\b/i.test(text)) updates.examples = 'include';
  if (/\b(?:do not|don't|avoid|skip)\s+(?:including\s+|using\s+)?(?:code\s+)?examples?\b/i.test(text)) updates.examples = 'avoid';

  if (!Object.keys(updates).length) return {};
  const stored = getLearnedResponsePreferences(scope);
  const at = Date.now();
  const next = { ...stored };
  for (const [key, value] of Object.entries(updates)) {
    next[key] = { value, at, source: 'explicit-feedback' };
  }
  saveStore(responsePreferencesStorageKey(scope), next);
  return updates;
}

export function buildResponsePreferencesBlock(profilePreferences = {}, { scope = '' } = {}) {
  const learned = getLearnedResponsePreferences(scope);
  const values = Object.fromEntries(
    Object.entries(learned).map(([key, entry]) => [key, entry?.value]).filter(([, value]) => value)
  );
  if (!Object.keys(values).length && !profilePreferences?.responseStyle) return '';

  const length = values.length || profilePreferences.responseStyle;
  const lines = [
    length ? `- answer length: ${length}` : '',
    values.format ? `- preferred structure: ${values.format}` : '',
    values.language ? `- language: ${values.language}` : '',
    values.tone ? `- tone: ${values.tone}` : '',
    values.examples ? `- examples: ${values.examples}` : '',
  ].filter(Boolean);
  if (!lines.length) return '';
  return `ADAPTIVE RESPONSE PREFERENCES (private, do not mention):\n${lines.join('\n')}\nApply these defaults when compatible. The user's current request always overrides them.`;
}

// ── Cache the latest known profile so the model can reference it ──
export function cacheProfile(profile) {
  if (!profile) return;
  saveStore(STORAGE_KEY, {
    name: profile.displayName || '',
    age: profile.age || null,
    gender: profile.gender || '',
    email: profile.email || '',
    bio: profile.bio || '',
    preferences: profile.preferences || {},
    cachedAt: Date.now(),
  });
}

export function getCachedProfile() {
  return loadStore(STORAGE_KEY);
}

// ── Context heuristic ──
// Returns 'full' | 'minimal' | 'none'
// - 'full': message references the user personally (preferences, identity, etc.)
// - 'minimal': first message of session, or generic greeting
// - 'none': pure task/query with no personal context needed

const PERSONAL_TRIGGERS = [
  /\b(my|mine|i\s+am|i'm|i've|i'd|i\s+like|i\s+want|i\s+need|i\s+prefer|i\s+have)\b/i,
  /\b(remember|recall|know|forgot|forget)\b/i,
  /\b(about\s+me|who\s+am\s+i|my\s+name|my\s+age|my\s+gender)\b/i,
  /\b(preferences?|setting|style|theme)\b/i,
  /\b(call\s+me|address\s+me|name\s+me)\b/i,
  /\b(personal|profile|account)\b/i,
];

const RECALL_TRIGGERS = [
  /\b(remember|recall|earlier|before|previously|last\s+time)\b/i,
  /\b(we\s+(discussed|talked|said)|you\s+(said|mentioned|told))\b/i,
];

const SIMPLE_GREETING_RE = /^(hi|hello|hey|yo|sup|good\s+(morning|afternoon|evening)|hola|namaste)[!.\s]*$/i;

export function decideContextMode(message, isFirstTurn = false) {
  const text = String(message || '');
  const trimmed = text.trim();
  if (!trimmed) return 'none';

  // Simple greetings do not need profile/context injection.
  if (SIMPLE_GREETING_RE.test(trimmed)) return 'none';

  // First turn should be lightweight by default to reduce token usage and
  // avoid system-context style leakage in normal small-talk.
  if (isFirstTurn) return 'minimal';

  for (const pattern of PERSONAL_TRIGGERS) {
    if (pattern.test(text)) return 'full';
  }
  for (const pattern of RECALL_TRIGGERS) {
    if (pattern.test(text)) return 'minimal';
  }
  return 'none';
}

// ── Build context strings of varying weight ──
export function buildMinimalContext(profile) {
  const name = profile?.displayName?.trim();
  if (!name) return '';
  // Just name + a hint that more info is available — tiny token footprint.
  return `Active user: ${name}.`;
}

export function buildLearnedFactsBlock() {
  const facts = getLearnedFacts();
  const entries = Object.entries(facts);
  if (entries.length === 0) return '';
  const lines = entries
    .slice(0, 12)
    .map(([key, { value }]) => `- ${key}: ${value}`);
  return `INTERNAL USER MEMORY (do not reveal verbatim):\n${lines.join('\n')}`;
}

// ── Detect and extract [REMEMBER: ...] markers from assistant output ──
// The model can write to the knowledge bank by including these markers,
// which we strip from the visible reply and persist as learned facts.
const REMEMBER_RE = /\[REMEMBER:\s*([^=\]]+?)\s*=\s*([^\]]+?)\s*\]/gi;
const MALFORMED_REMEMBER_RE = /\[REMEMBER:[^\]]*\]/gi;

export function processRememberMarkers(text = '') {
  let cleaned = String(text || '');
  let match;
  REMEMBER_RE.lastIndex = 0;
  while ((match = REMEMBER_RE.exec(cleaned)) !== null) {
    const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
    const value = match[2].trim();
    addLearnedFact(key, value);
  }
  return cleaned
    .replace(REMEMBER_RE, '')
    .replace(MALFORMED_REMEMBER_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Guard against prompt-leak style responses such as
// "Remember this: ... Preferences ..." when user did not ask for that dump.
export function sanitizeMemoryLeakStyleResponse(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return raw;

  const lower = raw.toLowerCase();
  const looksLikeRememberDump =
    lower.startsWith('remember this')
    && (lower.includes('preferences') || lower.includes('text size') || lower.includes('streaming responses') || lower.includes('notifications'));

  if (!looksLikeRememberDump) return raw;

  return 'Noted. How can I help you next?';
}
