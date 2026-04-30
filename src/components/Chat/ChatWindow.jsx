import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useChatContext } from '../../contexts/ChatContext';
import useChat from '../../hooks/useChat';
import useMemory from '../../hooks/useMemory';
import MessageBubble from './MessageBubble';
import WelcomeScreen from './WelcomeScreen';
import ChatInput from './ChatInput';
import VoiceMode from './VoiceMode';
import BrowserPanel from './BrowserPanel';
import CanvasPanel from './CanvasPanel';
import TaskRunner from './TaskRunner';
import ToolsPanel from './ToolsPanel';
import PromptLibrary from './PromptLibrary';
import ShareModal from './ShareModal';

const FONT_SIZE_MAP = { small: '13px', medium: '14px', large: '16px' };
function getStoredFontSize() {
  try { return FONT_SIZE_MAP[JSON.parse(localStorage.getItem('mira_preferences') || '{}').fontSize] || '14px'; }
  catch { return '14px'; }
}

export default function ChatWindow() {
  const { currentConversationId, isGenerating } = useChatContext();
  const { messages, streamingContent, thinkingContent, sendMessage, stopGenerating } = useChat();
  const { getMemoryContext, processAndSave } = useMemory();

  const [voiceMode, setVoiceMode] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const [panel, setPanel] = useState(null); // 'browser' | 'canvas' | 'tasks' | 'tools' | 'prompts'
  const [showShare, setShowShare] = useState(false);
  const [chatFontSize, setChatFontSize] = useState(getStoredFontSize);
  const bottomRef = useRef(null);

  const displayMessages = useMemo(() => {
    if (!isGenerating || messages.length === 0) return messages;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'assistant') return messages;
    return [
      ...messages.slice(0, -1),
      { ...lastMsg, content: streamingContent || lastMsg.content, thinkingContent: thinkingContent || undefined, isThinkingActive: !!thinkingContent && !streamingContent },
    ];
  }, [messages, streamingContent, thinkingContent, isGenerating]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamingContent, thinkingContent]);

  useEffect(() => {
    const handler = () => setChatFontSize(getStoredFontSize());
    window.addEventListener('mira-preferences-changed', handler);
    return () => window.removeEventListener('mira-preferences-changed', handler);
  }, []);

  // Auto-extract memories after each exchange
  useEffect(() => {
    if (messages.length < 2) return;
    const last = messages[messages.length - 1];
    const prev = messages[messages.length - 2];
    if (last.role === 'assistant' && prev.role === 'user') {
      processAndSave(prev.content, last.content);
    }
  }, [messages, processAndSave]);

  const sendWithMemory = useCallback((content, attachments, ws) => {
    const memCtx = getMemoryContext();
    const enriched = memCtx ? content + memCtx : content;
    sendMessage(enriched, attachments, ws);
  }, [sendMessage, getMemoryContext]);

  const togglePanel = (name) => setPanel(p => p === name ? null : name);

  return (
    <div className="flex-1 flex min-h-0 relative overflow-hidden">
      {voiceMode && (
        <VoiceMode onSend={(text) => { sendWithMemory(text, [], webSearch); setVoiceMode(false); }} onClose={() => setVoiceMode(false)} />
      )}
      {showShare && <ShareModal messages={messages} title={messages[0]?.content?.slice(0, 50)} onClose={() => setShowShare(false)} />}

      {/* Chat column */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <div className="flex-1 overflow-y-auto" style={{ fontSize: chatFontSize }}>
          <div className="max-w-3xl mx-auto flex flex-col justify-end min-h-full py-4 gap-5">
            {displayMessages.length === 0 ? (
              <WelcomeScreen onSend={(p) => sendWithMemory(p, [], webSearch)} />
            ) : (
              displayMessages.map((msg, i) => (
                <MessageBubble key={msg.id || i} message={msg} isLast={i === displayMessages.length - 1} />
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        <ChatInput
          onSend={(text, attachments) => sendWithMemory(text, attachments, webSearch)}
          onStop={stopGenerating}
          isGenerating={isGenerating}
          webSearch={webSearch}
          onToggleWebSearch={() => setWebSearch(v => !v)}
          activePanel={panel}
          onTogglePanel={togglePanel}
          onShare={() => setShowShare(true)}
          onUsePrompt={(p) => sendWithMemory(p, [], webSearch)}
          messages={messages}
        />
      </div>

      {/* Side panels */}
      {panel === 'browser' && (
        <div className="flex-shrink-0 animate-fade-in" style={{ width: 500 }}>
          <BrowserPanel onSendToChat={(c) => sendWithMemory(c, [], false)} onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === 'canvas' && (
        <div className="flex-shrink-0 animate-fade-in" style={{ width: 480 }}>
          <CanvasPanel messages={messages} onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === 'tasks' && (
        <div className="flex-shrink-0 animate-fade-in" style={{ width: 360 }}>
          <TaskRunner onSendMessage={(c) => sendWithMemory(c, [], false)} onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === 'tools' && (
        <div className="flex-shrink-0 animate-fade-in" style={{ width: 320 }}>
          <ToolsPanel onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === 'prompts' && (
        <div className="flex-shrink-0 animate-fade-in" style={{ width: 320 }}>
          <PromptLibrary onUsePrompt={(p) => { sendWithMemory(p, [], webSearch); setPanel(null); }} onClose={() => setPanel(null)} />
        </div>
      )}
    </div>
  );
}
