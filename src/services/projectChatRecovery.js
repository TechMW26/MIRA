export function resolveProjectConversationTarget({
  projectId = '',
  conversationId = '',
  conversation = null,
} = {}) {
  const project = String(projectId || '').trim();
  const current = String(conversationId || '').trim();
  const missing = Boolean(project && current && !conversation);
  return {
    conversationId: missing ? null : (current || null),
    recoveredMissingConversation: missing,
  };
}
