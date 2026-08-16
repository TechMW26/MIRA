export const MAX_PROMPT_QUEUE = 20;

export function createQueuedPrompt({ content, attachments = [], webSearch = false, conversationId = null }) {
  const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, content, attachments, webSearch, conversationId, queuedAt: Date.now() };
}

export function enqueuePrompt(queue, prompt) {
  if (!prompt || queue.length >= MAX_PROMPT_QUEUE) return queue;
  return [...queue, prompt];
}

export function removeQueuedPrompt(queue, promptId) {
  return queue.filter((prompt) => prompt.id !== promptId);
}

export function takeNextQueuedPrompt(queue) {
  return {
    next: queue[0] || null,
    remaining: queue.slice(1),
  };
}
