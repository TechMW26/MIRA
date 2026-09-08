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

export function mergeRealtimeAssistantSnapshot(incoming, previous = null, stableContent = '') {
  if (!incoming || incoming.role !== 'assistant') return incoming;

  const incomingContent = String(incoming.content || '');
  const priorContent = String(previous?.content || '');
  const stable = String(stableContent || '');
  const incomingImages = Array.isArray(incoming?.generatedMedia?.images)
    ? incoming.generatedMedia.images.filter((image) => String(image?.url || '').trim())
    : [];
  const previousImages = Array.isArray(previous?.generatedMedia?.images)
    ? previous.generatedMedia.images.filter((image) => String(image?.url || '').trim())
    : [];

  const merged = { ...incoming };

  // Realtime propagation may briefly replay an older message body. Once a
  // generated asset has a durable URL, never downgrade that message to only a
  // generation prompt: doing so causes the client to request a second random
  // image and visibly replace the correct result.
  if (previousImages.length > 0 && incomingImages.length === 0) {
    merged.generatedMedia = previous.generatedMedia;
  }

  if (!incomingContent.trim() && !incoming.isStreaming && (stable || priorContent.trim())) {
    merged.content = stable || priorContent;
  }

  return merged;
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
