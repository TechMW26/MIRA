const PENDING_ASSISTANT_ID = '__mira_pending_assistant__';

function pendingAssistantState(streamingContent = '', thinkingContent = '') {
  return {
    content: String(streamingContent || ''),
    thinkingContent: String(thinkingContent || '') || undefined,
    isThinkingActive: Boolean(thinkingContent && !streamingContent),
    isStreaming: true,
  };
}

/**
 * Keeps an assistant row visible for the entire generation lifecycle.
 *
 * The persisted timeline normally ends in the user's local echo until MIRA
 * saves its answer. Rendering only an existing assistant message therefore
 * leaves planning, model startup, and early thinking with no bubble at all.
 */
export function buildChatDisplayMessages({
  messages = [],
  isGenerating = false,
  streamingContent = '',
  thinkingContent = '',
} = {}) {
  const timeline = Array.isArray(messages) ? messages : [];
  if (!isGenerating) return timeline;

  const pending = pendingAssistantState(streamingContent, thinkingContent);
  const lastMessage = timeline[timeline.length - 1];

  if (lastMessage?.role === 'assistant') {
    return [
      ...timeline.slice(0, -1),
      {
        ...lastMessage,
        ...pending,
        content: pending.content || String(lastMessage.content || ''),
      },
    ];
  }

  return [
    ...timeline,
    {
      id: PENDING_ASSISTANT_ID,
      role: 'assistant',
      type: 'text',
      ...pending,
    },
  ];
}

