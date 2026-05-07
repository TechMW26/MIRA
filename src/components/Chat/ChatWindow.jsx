import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useChatContext } from '../../contexts/ChatContext';
import useChat from '../../hooks/useChat';
import useMemory from '../../hooks/useMemory';
import MessageBubble from './MessageBubble';
import WelcomeScreen from './WelcomeScreen';
import ChatInput from './ChatInput';
<<<<<<< HEAD
=======
import VoiceMode from './VoiceMode';
<<<<<<< Updated upstream
=======
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
=======
<<<<<<< HEAD
=======
>>>>>>> Stashed changes
}

/**
 * Floating, resizable right-side panel container.
 * Resize handle is on the LEFT edge — dragging left grows the panel,
 * dragging right shrinks it. Width state is per-panel-id (persisted).
 */
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
      const dx = startX - ev.clientX; // drag left -> positive -> grow
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
      style={{ width: width + 14 /* +handle gap */ }}
    >
      {/* Resize handle (left edge of the floating panel) */}
      <div
        onMouseDown={onHandleMouseDown}
        className="w-1 mr-2 my-2 rounded-full cursor-col-resize flex-shrink-0 transition-all"
        style={{
          background: resizing ? 'var(--accent)' : 'var(--border)',
          opacity: resizing ? 1 : 0.5,
        }}
        title="Drag to resize"
      />
      {/* Floating glass container (matches sidebar) */}
      <div className="flex-1 min-w-0 rounded-2xl overflow-hidden glass-strong">
        {children}
      </div>
    </div>
  );
<<<<<<< Updated upstream
=======
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
}

export default function ChatWindow() {
  const { currentConversationId, isGenerating } = useChatContext();
  const { messages, streamingContent, thinkingContent, sendMessage, stopGenerating } = useChat();
  const { getMemoryContext, processAndSave } = useMemory();

<<<<<<< Updated upstream
  const [voiceMode, setVoiceMode] = useState(false);
=======
<<<<<<< HEAD
=======
  const [voiceMode, setVoiceMode] = useState(false);
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
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
<<<<<<< Updated upstream
=======
<<<<<<< HEAD
    const enriched = memCtx ? content + memCtx : content;
    sendMessage(enriched, attachments, ws);
  }, [sendMessage, getMemoryContext]);

  const requestCanvas = useCallback((prompt) => {
    if (!prompt?.trim()) return;
    sendWithMemory(prompt, [], false);
  }, [sendWithMemory]);

=======
>>>>>>> Stashed changes
    // Memory is sent as a hidden side-channel; it must NOT appear in the
    // user's chat bubble or be persisted to the message DB.
    sendMessage(content, attachments, ws, { memoryContext: memCtx });
  }, [sendMessage, getMemoryContext]);

<<<<<<< Updated upstream
=======
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
  const togglePanel = (name) => setPanel(p => p === name ? null : name);

  return (
    <div className="flex-1 flex min-h-0 relative overflow-hidden">
<<<<<<< Updated upstream
      {voiceMode && (
        <VoiceMode onSend={(text) => { sendWithMemory(text, [], webSearch); setVoiceMode(false); }} onClose={() => setVoiceMode(false)} />
      )}
=======
<<<<<<< HEAD
=======
      {voiceMode && (
        <VoiceMode onSend={(text) => { sendWithMemory(text, [], webSearch); setVoiceMode(false); }} onClose={() => setVoiceMode(false)} />
      )}
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
      {showShare && <ShareModal messages={messages} title={messages[0]?.content?.slice(0, 50)} onClose={() => setShowShare(false)} />}

      {/* Chat column */}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
<<<<<<< Updated upstream
        <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ fontSize: chatFontSize }}>
          <div className="max-w-3xl mx-auto flex flex-col justify-end min-h-full py-4 gap-5 px-3 w-full min-w-0">
=======
<<<<<<< HEAD
        <div className="flex-1 overflow-y-auto" style={{ fontSize: chatFontSize }}>
          <div className="max-w-3xl mx-auto flex flex-col justify-end min-h-full py-4 gap-5">
=======
        <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ fontSize: chatFontSize }}>
          <div className="max-w-3xl mx-auto flex flex-col justify-end min-h-full py-4 gap-5 px-3 w-full min-w-0">
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
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

<<<<<<< Updated upstream
=======
<<<<<<< HEAD
      {/* Side panels */}
      {panel === 'browser' && (
        <div className="flex-shrink-0 animate-fade-in" style={{ width: 500 }}>
          <BrowserPanel onSendToChat={(c) => sendWithMemory(c, [], false)} onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === 'canvas' && (
        <div className="flex-shrink-0 animate-fade-in" style={{ width: 480 }}>
          <CanvasPanel messages={messages} onClose={() => setPanel(null)} onRequestCanvas={requestCanvas} />
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
=======
>>>>>>> Stashed changes
      {/* Floating, resizable side panels (match sidebar style) */}
      {panel === 'browser' && (
        <RightPanel id="browser" defaultWidth={500} minWidth={340} maxWidth={900}>
          <BrowserPanel onSendToChat={(c) => sendWithMemory(c, [], false)} onClose={() => setPanel(null)} />
        </RightPanel>
      )}
      {panel === 'canvas' && (
        <RightPanel id="canvas" defaultWidth={480} minWidth={320} maxWidth={1000}>
          <CanvasPanel messages={messages} onClose={() => setPanel(null)} />
        </RightPanel>
      )}
      {panel === 'tasks' && (
        <RightPanel id="tasks" defaultWidth={360} minWidth={280} maxWidth={720}>
          <TaskRunner onSendMessage={(c) => sendWithMemory(c, [], false)} onClose={() => setPanel(null)} />
        </RightPanel>
      )}
      {panel === 'tools' && (
        <RightPanel id="tools" defaultWidth={320} minWidth={260} maxWidth={620}>
          <ToolsPanel onClose={() => setPanel(null)} />
        </RightPanel>
      )}
      {panel === 'prompts' && (
        <RightPanel id="prompts" defaultWidth={340} minWidth={280} maxWidth={680}>
          <PromptLibrary onUsePrompt={(p) => { sendWithMemory(p, [], webSearch); setPanel(null); }} onClose={() => setPanel(null)} />
        </RightPanel>
<<<<<<< Updated upstream
=======
>>>>>>> cf085363c0fd2c2330d2383b94412aabd13efb38
>>>>>>> Stashed changes
      )}
    </div>
  );
}
