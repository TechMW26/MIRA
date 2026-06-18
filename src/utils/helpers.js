export function formatTimestamp(ts) {
  const date = new Date(ts);
  const now = new Date();
  const diff = now - date;
  const dayMs = 86400000;

  if (diff < dayMs && date.getDate() === now.getDate()) return 'Today';
  if (diff < 2 * dayMs) return 'Yesterday';
  if (diff < 7 * dayMs) return 'Previous 7 Days';
  if (diff < 30 * dayMs) return 'Previous 30 Days';
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function groupConversationsByDate(conversations) {
  const groups = {};
  for (const conv of conversations) {
    const label = formatTimestamp(conv.updatedAt || conv.createdAt);
    if (!groups[label]) groups[label] = [];
    groups[label].push(conv);
  }
  return groups;
}

export function generateTitle(text) {
  const cleaned = String(text || '')
    .replace(/\[[A-Z_]+:[^\]]*\]/g, ' ')
    .replace(/\[Attached:[^\]]*\]/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#*`"'“”‘’()[\]{}]/g, ' ')
    .replace(/\b(?:please|kindly|can you|could you|would you|tell me about|tell me|show me|give me|explain|help me|i want to know|something about|information about)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'New Chat';

  const words = cleaned.split(/\s+/).filter(Boolean);
  const selected = words.slice(0, 8);

  return selected
    .join(' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^./, (letter) => letter.toUpperCase());
}

export async function generateSmartTitle(userMessage, assistantMessage) {
  return generateTitle(userMessage || assistantMessage);
}

export async function generateConversationTitle(messages = []) {
  const seen = new Set();
  const userText = (Array.isArray(messages) ? messages : [])
    .filter((message) => message?.role === 'user')
    .map((message) => String(message?.content || '').trim())
    .filter(Boolean)
    .filter((content) => {
      const key = content.toLowerCase().replace(/\s+/g, ' ');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(-3)
    .join(' ');
  return generateTitle(userText);
}

export function detectIntent(message) {
  const lower = message.toLowerCase();
  if (
    lower.includes('generate image') ||
    lower.includes('create image') ||
    lower.includes('draw') ||
    lower.includes('make a picture') ||
    lower.includes('generate a picture') ||
    lower.includes('create an image')
  ) {
    return 'image';
  }
  return 'chat';
}

export function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

// ── User context system prompt ──────────────────────────────
// Builds a concise system block so the model always knows WHO it is talking to
// and what the current chat is about, even after history truncation.

const PREFERENCE_LABELS = {
  responseStyle: 'preferred response style',
  codeTheme: 'code theme',
  fontSize: 'text size',
  streamResponses: 'streaming responses',
  notifications: 'notifications',
};

function stripMarkdown(text = '') {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#*_>~|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function condense(text = '', maxLen = 160) {
  const clean = stripMarkdown(text);
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1).trimEnd()}…`;
}

function formatPreferences(preferences = {}) {
  const entries = Object.entries(preferences || {})
    .filter(([key, value]) => key in PREFERENCE_LABELS && value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => {
      const label = PREFERENCE_LABELS[key];
      if (typeof value === 'boolean') return `${label}: ${value ? 'on' : 'off'}`;
      return `${label}: ${value}`;
    });
  return entries.length ? entries.join('; ') : '';
}

function summarizeMessages(messages = [], { maxTurns = 6 } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  // Look at the last few turns so the recap stays compact.
  const recent = list.slice(-maxTurns * 2);
  const lines = [];
  for (const message of recent) {
    if (!message || !message.role) continue;
    const role = message.role === 'assistant' ? 'MIRA' : message.role === 'user' ? 'User' : null;
    if (!role) continue;
    const text = typeof message.content === 'string' ? message.content : '';
    const condensed = condense(text, 140);
    if (!condensed) continue;
    lines.push(`- ${role}: ${condensed}`);
  }
  return lines.join('\n');
}

export function buildUserContextPrompt({ profile, conversation, messages = [] } = {}) {
  const sections = [];
  const aboutLines = [];

  const name = profile?.displayName?.trim();
  if (name) aboutLines.push(`Name: ${name}`);
  if (profile?.age) aboutLines.push(`Age: ${profile.age}`);
  if (profile?.gender) aboutLines.push(`Gender: ${profile.gender}`);
  if (profile?.email) aboutLines.push(`Email: ${profile.email}`);
  const bio = profile?.bio?.trim();
  if (bio) aboutLines.push(`Bio: ${condense(bio, 240)}`);
  const prefs = formatPreferences(profile?.preferences);
  if (prefs) aboutLines.push(`Preferences: ${prefs}`);

  if (aboutLines.length) {
    sections.push(`THE USER YOU ARE TALKING TO\n${aboutLines.join('\n')}\n\nUsage rules:\n- Address the user by their name when natural; never invent a different name.\n- Honor the stated preferences (especially response style).\n- Treat age, gender, and bio as background context, not topics to bring up unless the user does.`);
  }

  const totalMessages = Array.isArray(messages) ? messages.length : 0;
  const conversationLines = [];
  if (conversation?.title && conversation.title !== 'New Chat') {
    conversationLines.push(`Title: ${conversation.title}`);
  }
  if (totalMessages > 0) {
    conversationLines.push(`Messages so far: ${totalMessages}`);
  }
  const recap = summarizeMessages(messages, { maxTurns: 6 });
  if (recap) {
    conversationLines.push(`Recent exchanges (most recent last):\n${recap}`);
  }

  if (conversationLines.length) {
    sections.push(`CURRENT CONVERSATION RECAP\n${conversationLines.join('\n')}\n\nUse this recap to stay consistent with what was already said. The full transcript follows in the chat messages — do not repeat it back unless asked.`);
  }

  return sections.join('\n\n');
}

// ── Token-efficient adaptive context builder ──
// Only emits the heavy "THE USER YOU ARE TALKING TO" block when the user
// message references personal info. Otherwise sends minimal or no context.
// The model can also write back to the knowledge bank via [REMEMBER: key=value].
export function buildAdaptiveContext({ profile, conversation, messages = [], mode = 'minimal', learnedFacts = '' } = {}) {
  if (mode === 'none') return '';

  const sections = [];

  if (mode === 'minimal') {
    const name = profile?.displayName?.trim();
    if (name) {
      sections.push(`Active user: ${name}.`);
    }
    return sections.join('\n\n');
  }

  // mode === 'full' — full context, but trim conversation recap aggressively
  const full = buildUserContextPrompt({ profile, conversation, messages });
  if (full) sections.push(full);
  if (learnedFacts) {
    sections.push(`${learnedFacts}\n\nInternal usage rule: Use these facts only for personalization. Do not list, dump, or quote this memory block unless the user explicitly asks for their saved preferences/profile.`);
  }
  return sections.join('\n\n');
}
