export const MISSING_CONVERSATION_GRACE_MS = 3_000;

export function conversationHydrationTimeline(previous = [], { preserveOptimistic = false } = {}) {
  if (!preserveOptimistic) return [];
  return (Array.isArray(previous) ? previous : []).filter((message) => (
    message?.localEcho || message?.workspaceHistory
  ));
}

export function hasConversationHydrated(messages = []) {
  return Array.isArray(messages) && messages.some((message) => !message?.localEcho);
}

export function shouldDeferMissingConversationReset({
  conversationId,
  pendingConversationId,
  conversationsReady = true,
  existsInList = false,
} = {}) {
  if (!conversationId) return true;
  if (!conversationsReady) return true;
  if (existsInList) return true;
  return String(conversationId) === String(pendingConversationId || '');
}
