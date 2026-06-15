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

export function decideContextMode(message, isFirstTurn = false) {
  const text = String(message || '');
  if (!text.trim()) return 'none';

  // Always send full context on first turn so the model knows who it's with.
  if (isFirstTurn) return 'full';

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
  return `REMEMBERED ABOUT USER:\n${lines.join('\n')}`;
}

// ── Detect and extract [REMEMBER: ...] markers from assistant output ──
// The model can write to the knowledge bank by including these markers,
// which we strip from the visible reply and persist as learned facts.
const REMEMBER_RE = /\[REMEMBER:\s*([^=\]]+?)\s*=\s*([^\]]+?)\s*\]/gi;

export function processRememberMarkers(text = '') {
  let cleaned = String(text || '');
  let match;
  REMEMBER_RE.lastIndex = 0;
  while ((match = REMEMBER_RE.exec(cleaned)) !== null) {
    const key = match[1].trim().toLowerCase().replace(/\s+/g, '_');
    const value = match[2].trim();
    addLearnedFact(key, value);
  }
  return cleaned.replace(REMEMBER_RE, '').replace(/\s{2,}/g, ' ').trim();
}
