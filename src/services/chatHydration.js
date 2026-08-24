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
