import { runChatCompletion } from './api.js';

const ANALYSIS_SYSTEM_PROMPT = 'You are MIRA, a precise analysis assistant. Analyze the user input directly and return a clear, useful result.';

export async function analyzeText(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt must be a non-empty string');
  }

  return runChatCompletion({
    systemPrompt: ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });
}

export async function analyzeTextBatch(prompts) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('Prompts must be a non-empty array');
  }

  const results = await Promise.allSettled(prompts.map((prompt) => analyzeText(prompt)));
  return results.map((result) => ({
    ok: result.status === 'fulfilled',
    data: result.value,
    error: result.reason?.message,
  }));
}