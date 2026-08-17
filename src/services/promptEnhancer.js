/**
 * MIRA Prompt Enhancer
 *
 * Runs a focused preflight using the configured model before the main reply to either:
 *   1. clarify — ask one short question when a creation request is missing critical info
 *   2. enhance — rewrite a basic prompt into a richer, end-to-end prompt
 *   3. pass    — do nothing (greetings, lookups, follow-ups, etc.)
 *
 * Single round-trip, low temperature, no streaming, no tools.
 */

import { runChatCompletion } from './api.js';

const EXPLICIT_PROMPT_REFINEMENT_RE = /(?:\b(?:refine|improve|rewrite|enhance|optimi[sz]e)\b.{0,40}\bprompt\b|\bprompt\b.{0,40}\b(?:refine|improve|rewrite|enhance|optimi[sz]e)\b)/i;

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

  const text = String(content || '').trim();
  if (!text) return false;
  if (interpretation?.videoIntent) return false;

  // Normal requests are already refined by the main model's system contract.
  // A second model pass before the real answer materially delays first-token
  // delivery, so reserve it for users who explicitly ask for prompt editing.
  return EXPLICIT_PROMPT_REFINEMENT_RE.test(text);
}

export function mergeOriginalImageRequest(original = '', refinement = '') {
  const mandatory = String(original || '').replace(/\s+/g, ' ').trim();
  const additive = String(refinement || '').replace(/\s+/g, ' ').trim();
  if (!mandatory) return additive;
  if (!additive || additive.toLowerCase() === mandatory.toLowerCase()) return mandatory;

  return `MANDATORY USER REQUIREMENTS (preserve every detail exactly): ${mandatory}\n\nADDITIVE VISUAL REFINEMENT (may enrich, but must not override, reinterpret, or omit the requirements above): ${additive}`;
}

function buildSystemPrompt(routeHint, imageIntent = false) {
  const imageRules = imageIntent
    ? `\nIMAGE REFINEMENT RULES:\n- Preserve every user-provided subject, exact count, identity, attribute, relationship, action, visible text and spelling, color, style, camera/composition detail, lighting detail, background detail, aspect ratio, exclusion, and negative constraint.\n- Refinement is additive only. Add compatible visual specificity, but never replace, summarize away, reinterpret, or contradict a supplied detail.\n- If details conflict, retain the user's wording instead of guessing.\n- Do not add people, objects, text, or sensitive content that the user did not request.`
    : '';

  return `You are a prompt pre-processor for an AI assistant. Decide ONE action for the user's request and reply ONLY as compact JSON.

ACTIONS:
1. "clarify" — choose ONLY when the user is asking to CREATE/BUILD/WRITE/DESIGN/GENERATE something AND a critical detail is missing that you genuinely need to deliver a useful result (e.g., target language/framework, audience, topic, length, format, style). Provide ONE short clarifying question, max 22 words, asking for the SINGLE most important missing detail. Do not bombard the user with multiple questions. Do not ask trivial or stylistic questions if reasonable defaults exist.

2. "enhance" — choose for any creation/build/write/design request where you can produce a clearer, more actionable prompt by spelling out structure, constraints, output format, edge cases, or sensible defaults. PRESERVE every requirement the user gave. Do not contradict, do not change the language they asked for, do not invent unrelated topics. Output a single self-contained instruction (no headings, no preamble, no markdown fences).

3. "pass" — choose for factual questions, lookups, casual chat, greetings, short follow-ups, or anything where rewriting would be wasteful or harmful.
${imageRules}

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
  const imageIntent = interpretation?.imageIntent === true;
  const routeHint = imageIntent ? 'image-generation' : (interpretation?.route || 'chat');
  const userMessage = `User request:\n"""\n${String(content || '').trim()}\n"""`;

  let raw = '';
  try {
    const result = await runChatCompletion({
      messages: [{ role: 'user', content: userMessage }],
      systemPrompt: buildSystemPrompt(routeHint, imageIntent),
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
    return { action: 'clarify', question: question.slice(0, 260) };
  }

  if (action === 'enhance') {
    const prompt = String(parsed?.prompt || '').trim();
    if (!prompt) return { action: 'pass' };
    if (imageIntent) {
      return {
        action: 'enhance',
        prompt: mergeOriginalImageRequest(content, prompt),
      };
    }
    // Reject obviously bad rewrites that throw away the original intent.
    if (prompt.length < Math.max(40, Math.floor(String(content).length * 0.6))) {
      return { action: 'pass' };
    }
    return { action: 'enhance', prompt };
  }

  return { action: 'pass' };
}
