import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useChatContext } from '../../contexts/ChatContext';
import useChat from '../../hooks/useChat';
import MessageBubble from './MessageBubble';
import WelcomeScreen from './WelcomeScreen';
import ChatInput from './ChatInput';
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

function RightPanel({ id, defaultWidth, minWidth = 280, maxWidth = 900, children }) {
  const storageKey = `mira_panel_w_${id}`;
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return stored && stored >= minWidth && stored <= maxWidth ? stored : defaultWidth;
  });
  const [resizing, setResizing] = useState(false);

  useEffect(() => {
    localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  function onHandleMouseDown(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    setResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (ev) => {
      const dx = startX - ev.clientX;
      const next = Math.max(minWidth, Math.min(maxWidth, startW + dx));
      setWidth(next);
    };
    const onUp = () => {
      setResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  return (
    <div
      className="flex-shrink-0 flex h-full py-3 pr-3 pl-0 animate-fade-in"
      style={{ width: width + 14 }}
    >
      <div
        onMouseDown={onHandleMouseDown}
        className="w-1 mr-2 my-2 rounded-full cursor-col-resize flex-shrink-0 transition-all"
        style={{
          background: resizing ? 'var(--accent)' : 'var(--border)',
          opacity: resizing ? 1 : 0.5,
        }}
        title="Drag to resize"
      />
      <div className="flex-1 min-w-0 rounded-2xl overflow-hidden glass-strong">
        {children}
      </div>
    </div>
  );
}

export default function ChatWindow() {
  const { currentConversationId, isGenerating, isSearching } = useChatContext();
  const { messages, streamingContent, thinkingContent, sendMessage, stopGenerating, retryMessage, editMessage } = useChat();

  const [webSearch, setWebSearch] = useState(false);
  const [panel, setPanel] = useState(null); // 'browser' | 'canvas' | 'tasks' | 'tools' | 'prompts'
  const [showShare, setShowShare] = useState(false);
  const [chatFontSize, setChatFontSize] = useState(getStoredFontSize);
  const scrollAreaRef = useRef(null);
  const autoScrollRef = useRef(true);

  const displayMessages = useMemo(() => {
    if (!isGenerating || messages.length === 0) return messages;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'assistant') return messages;
    return [
      ...messages.slice(0, -1),
      { ...lastMsg, content: streamingContent || lastMsg.content, thinkingContent: thinkingContent || undefined, isThinkingActive: !!thinkingContent && !streamingContent, isStreaming: true },
    ];
  }, [messages, streamingContent, thinkingContent, isGenerating]);

  const handleScroll = useCallback(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, []);

  useEffect(() => {
    if (!autoScrollRef.current) return undefined;
    const frame = requestAnimationFrame(() => {
      const el = scrollAreaRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [displayMessages.length, streamingContent, thinkingContent]);

  useEffect(() => {
    const handler = () => setChatFontSize(getStoredFontSize());
    window.addEventListener('mira-preferences-changed', handler);
    return () => window.removeEventListener('mira-preferences-changed', handler);
  }, []);

  const sendToChat = useCallback((content, attachments, ws, options = {}) => {
    sendMessage(content, attachments, ws, options);
  }, [sendMessage]);

  const sendBrowserPayloadToChat = useCallback((payload) => {
    if (typeof payload === 'string') {
      sendToChat(payload, [], false);
      return;
    }
    sendToChat(payload.content || 'Summarize this page', [], false, {
      promptContent: payload.promptContent,
      webPage: payload.webPage,
    });
  }, [sendToChat]);

  const requestCanvas = useCallback((prompt) => {
    if (!prompt?.trim()) return;
    sendToChat(prompt, [], false);
  }, [sendToChat]);

  const togglePanel = (name) => setPanel(p => p === name ? null : name);

  return (
    <div className="flex-1 flex min-h-0 relative">
      {showShare && <ShareModal messages={messages} title={messages[0]?.content?.slice(0, 50)} onClose={() => setShowShare(false)} />}

      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        <div ref={scrollAreaRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden" style={{ fontSize: chatFontSize }}>
          <div className="max-w-3xl mx-auto flex flex-col justify-end min-h-full py-4 gap-5 px-3 w-full min-w-0">
            {displayMessages.length === 0 ? (
              <WelcomeScreen onSend={(p, atts = []) => sendToChat(p, atts, webSearch)} />
            ) : (
              displayMessages.map((msg, i) => (
                <MessageBubble
                  key={msg.id || i}
                  message={msg}
                  isLast={i === displayMessages.length - 1}
                  onRetry={retryMessage}
                  onEdit={editMessage}
                  webSearch={webSearch}
                  isGenerating={isGenerating}
                  isSearching={isSearching}
                />
              ))
            )}
          </div>
        </div>

        <ChatInput
          onSend={(text, attachments) => sendToChat(text, attachments, webSearch)}
          onStop={stopGenerating}
          isGenerating={isGenerating}
          isSearching={isSearching}
          webSearch={webSearch}
          onToggleWebSearch={() => setWebSearch(v => !v)}
          activePanel={panel}
          onTogglePanel={togglePanel}
          onShare={() => setShowShare(true)}
          messages={messages}
        />
      </div>

      {panel === 'browser' && (
        <RightPanel id="browser" defaultWidth={500} minWidth={340} maxWidth={900}>
          <BrowserPanel onSendToChat={sendBrowserPayloadToChat} onClose={() => setPanel(null)} />
        </RightPanel>
      )}
      {panel === 'canvas' && (
        <RightPanel id="canvas" defaultWidth={480} minWidth={320} maxWidth={1000}>
          <CanvasPanel messages={messages} onClose={() => setPanel(null)} onRequestCanvas={requestCanvas} />
        </RightPanel>
      )}
      {panel === 'tasks' && (
        <RightPanel id="tasks" defaultWidth={360} minWidth={280} maxWidth={720}>
          <TaskRunner onSendMessage={(c) => sendToChat(c, [], false)} onClose={() => setPanel(null)} />
        </RightPanel>
      )}
      {panel === 'tools' && (
        <RightPanel id="tools" defaultWidth={320} minWidth={260} maxWidth={620}>
          <ToolsPanel onClose={() => setPanel(null)} />
        </RightPanel>
      )}
      {panel === 'prompts' && (
        <RightPanel id="prompts" defaultWidth={340} minWidth={280} maxWidth={680}>
          <PromptLibrary onUsePrompt={(p) => { sendToChat(p, [], webSearch); setPanel(null); }} onClose={() => setPanel(null)} />
        </RightPanel>
      )}
    </div>
  );
}
