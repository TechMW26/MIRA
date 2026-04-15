import { useState, useEffect, useRef, useMemo } from 'react';
import { useChatContext } from '../../contexts/ChatContext';
import useChat from '../../hooks/useChat';
import MessageBubble from './MessageBubble';
import WelcomeScreen from './WelcomeScreen';
import ChatInput from './ChatInput';
import VoiceMode from './VoiceMode';

const FONT_SIZE_MAP = { small: '13px', medium: '14px', large: '16px' };

function getStoredFontSize() {
  try {
    const prefs = JSON.parse(localStorage.getItem('mira_preferences') || '{}');
    return FONT_SIZE_MAP[prefs.fontSize] || '14px';
  } catch { return '14px'; }
}

export default function ChatWindow() {
  const { currentConversationId, isGenerating } = useChatContext();
  const { messages, streamingContent, thinkingContent, sendMessage, stopGenerating } = useChat();
  const [voiceMode, setVoiceMode] = useState(false);
  const [chatFontSize, setChatFontSize] = useState(getStoredFontSize);
  const bottomRef = useRef(null);

  // Merge streaming & thinking into the last assistant message for live display
  const displayMessages = useMemo(() => {
    if (!isGenerating || messages.length === 0) return messages;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'assistant') return messages;

    return [
      ...messages.slice(0, -1),
      {
        ...lastMsg,
        content: streamingContent || lastMsg.content,
        thinkingContent: thinkingContent || undefined,
        isThinkingActive: !!thinkingContent && !streamingContent,
      },
    ];
  }, [messages, streamingContent, thinkingContent, isGenerating]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, thinkingContent]);

  // Listen for preference changes
  useEffect(() => {
    const handler = () => setChatFontSize(getStoredFontSize());
    window.addEventListener('mira-preferences-changed', handler);
    return () => window.removeEventListener('mira-preferences-changed', handler);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Voice overlay */}
      {voiceMode && (
        <VoiceMode
          onSend={(text) => { sendMessage(text); setVoiceMode(false); }}
          onClose={() => setVoiceMode(false)}
        />
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto" style={{ fontSize: chatFontSize }}>
        <div className="max-w-3xl mx-auto flex flex-col justify-end min-h-full py-4 gap-5">
          {displayMessages.length === 0 ? (
            <WelcomeScreen onSend={sendMessage} />
          ) : (
            displayMessages.map((msg, i) => (
              <MessageBubble key={msg.id || i} message={msg} isLast={i === displayMessages.length - 1} />
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <ChatInput onSend={sendMessage} onStop={stopGenerating} isGenerating={isGenerating} />
    </div>
  );
}
