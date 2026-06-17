/**
 * MIRA Prompt Enhancer
 *
 * Runs a small/fast model BEFORE the main reply to either:
 *   1. clarify — ask one short question when a creation request is missing critical info
 *   2. enhance — rewrite a basic prompt into a richer, end-to-end prompt
 *   3. pass    — do nothing (greetings, lookups, follow-ups, etc.)
 *
 * Single round-trip, low temperature, no streaming, no tools.
 */

import { runChatCompletion } from './api';

// Pre-flight is intentionally on Mira Lite for sub-second turnaround;
// only the rare high-complexity creation request bumps up to Mira Pro.
const ENHANCER_MODEL = 'mira-lite';
const ENHANCER_MODEL_PRO = 'mira-pro';

const CREATE_VERB_RE = /\b(build|create|make|design|write|implement|generate|develop|produce|craft|compose|draft|code|construct|architect|prototype|set\s*up|spin\s*up)\b/i;
const SHORT_LOOKUP_RE = /^\s*(what|who|when|where|why|how|is|are|do|does|did|can|could|should|would|will|tell\s+me|show\s+me|give\s+me)\b/i;

export function shouldRunEnhancer({
  content,
  interpretation,
  hasImages,
  hasAttachments,
  isReplay,
  isGreeting,
  isDocument,
}) {
  if (isReplay || isGreeting || isDocument) return false;
  if (hasImages || hasAttachments) return false;
  if (interpretation?.imageIntent || interpretation?.videoIntent) return false;

  const text = String(content || '').trim();
  if (!text) return false;

  // Lookups, follow-ups, and casual chat: never run the pre-flight model —
  // it would add a full extra round-trip before any tokens stream back.
  if (SHORT_LOOKUP_RE.test(text) && !CREATE_VERB_RE.test(text)) return false;

  // Only spend a pre-flight round on substantive creation requests that
  // genuinely benefit from rewriting or clarification.
  const isCreationRequest = CREATE_VERB_RE.test(text);
  if (!isCreationRequest) return false;
  if (text.length < 80) return false;

  return true;
}

function buildSystemPrompt(routeHint) {
  return `You are a prompt pre-processor for an AI assistant. Decide ONE action for the user's request and reply ONLY as compact JSON.

ACTIONS:
1. "clarify" — choose ONLY when the user is asking to CREATE/BUILD/WRITE/DESIGN/GENERATE something AND a critical detail is missing that you genuinely need to deliver a useful result (e.g., target language/framework, audience, topic, length, format, style). Provide ONE short clarifying question, max 22 words, asking for the SINGLE most important missing detail. Do not bombard the user with multiple questions. Do not ask trivial or stylistic questions if reasonable defaults exist.

2. "enhance" — choose for any creation/build/write/design request where you can produce a clearer, more actionable prompt by spelling out structure, constraints, output format, edge cases, or sensible defaults. PRESERVE every requirement the user gave. Do not contradict, do not change the language they asked for, do not invent unrelated topics. Output a single self-contained instruction (no headings, no preamble, no markdown fences).

3. "pass" — choose for factual questions, lookups, casual chat, greetings, short follow-ups, or anything where rewriting would be wasteful or harmful.

OUTPUT SHAPES (one only, no extra text, no markdown fences):
{"action":"clarify","question":"..."}
{"action":"enhance","prompt":"..."}
{"action":"pass"}

Route hint: ${routeHint || 'chat'}.`;
}

function extractJsonObject(text) {
  if (!text) return '';
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return '';
  return candidate.slice(start, end + 1);
}

export async function assessAndRefinePrompt({ content, interpretation }) {
  const routeHint = interpretation?.route || 'chat';
  const enhancerModel = interpretation?.classification?.complexity === 'high'
    ? ENHANCER_MODEL_PRO
    : ENHANCER_MODEL;
  const userMessage = `User request:\n"""\n${String(content || '').trim()}\n"""`;

  let raw = '';
  try {
    const result = await runChatCompletion({
      messages: [{ role: 'user', content: userMessage }],
      model: enhancerModel,
      systemPrompt: buildSystemPrompt(routeHint),
      tools: [],
      think: false,
      maxTokens: 700,
    });
    raw = String(result?.result || '').trim();
  } catch {
    return { action: 'pass' };
  }

  const jsonText = extractJsonObject(raw);
  if (!jsonText) return { action: 'pass' };

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { action: 'pass' };
  }

  const action = String(parsed?.action || '').toLowerCase();

  if (action === 'clarify') {
    const question = String(parsed?.question || '').trim().replace(/\s+/g, ' ');
    if (!question || question.length < 6) return { action: 'pass' };
    return { action: 'clarify', question: question.slice(0, 260), model: enhancerModel };
  }

  if (action === 'enhance') {
    const prompt = String(parsed?.prompt || '').trim();
    if (!prompt) return { action: 'pass' };
    // Reject obviously bad rewrites that throw away the original intent.
    if (prompt.length < Math.max(40, Math.floor(String(content).length * 0.6))) {
      return { action: 'pass' };
    }
    return { action: 'enhance', prompt, model: enhancerModel };
  }

  return { action: 'pass' };
}
