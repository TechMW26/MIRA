import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useChatContext } from '../../contexts/ChatContext';
import useChat from '../../hooks/useChat';
import useUserProfile from '../../hooks/useUserProfile';
import {
  enqueueConversationPrompt,
  removeConversationPrompt,
  subscribeConversationQueue,
  subscribeConversationRun,
  updateConversationPrompt,
} from '../../services/database';
import {
  createQueuedPrompt,
  enqueuePrompt,
  MAX_PROMPT_QUEUE,
  removeQueuedPrompt,
  takeNextQueuedPrompt,
  updateQueuedPrompt,
} from '../../utils/promptQueue';
import MessageBubble from './MessageBubble';
import WelcomeScreen from './WelcomeScreen';
import ParticleGlobe from './ParticleGlobe';
import ChatInput from './ChatInput';
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

function RightPanel({ id, defaultWidth, minWidth = 280, maxWidth = 900, workspaceMode = false, onClose, children }) {
  const storageKey = `mira_panel_w_${id}`;
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return stored && stored >= minWidth && stored <= maxWidth ? stored : defaultWidth;
  });
  const [resizing, setResizing] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => (
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false
  ));

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 1023px)');
    const onChange = () => setIsNarrowViewport(media.matches);
    onChange();
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, String(width));
  }, [storageKey, width]);

  useEffect(() => {
    if (!onClose) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

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

  if (workspaceMode) {
    return (
      <div
        className="absolute z-[60] flex animate-fade-in desktop-right-panel desktop-right-panel-pip"
        style={{ width: `min(calc(100% - 28px), ${width + 14}px)` }}
      >
        <div
          onMouseDown={onHandleMouseDown}
          className="desktop-right-panel-resizer rounded-full cursor-col-resize flex-shrink-0 transition-all"
          style={{
            background: resizing ? 'var(--accent)' : 'var(--border)',
            opacity: resizing ? 1 : 0.5,
          }}
          title="Drag to resize"
        />
        <div className="flex-1 min-w-0 h-full overflow-hidden glass-strong desktop-right-panel-surface">
          {children}
        </div>
      </div>
    );
  }

  if (isNarrowViewport) {
    return (
      <div className="fixed inset-0 z-50 flex animate-fade-in">
        <div className="w-full h-full overflow-hidden glass-strong" style={{ borderLeft: '1px solid var(--hud-cyan-dim)' }}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed top-0 right-0 bottom-0 z-40 flex animate-fade-in"
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
      <div className="flex-1 min-w-0 h-full overflow-hidden glass-strong" style={{ borderLeft: '1px solid var(--hud-cyan-dim)' }}>
        {children}
      </div>
    </div>
  );
}

export default function ChatWindow() {
  const { currentConversationId, isGenerating, isSearching, activeProjectId, showWorkspace } = useChatContext();
  const {
    messages,
    streamingContent,
    thinkingContent,
    taskWorkflow,
    clearTaskWorkflow,
    sendMessage,
    stopGenerating,
    retryMessage,
    editMessage,
  } = useChat();
  const userProfile = useUserProfile();

  const [webSearch, setWebSearch] = useState(false);
  const [panel, setPanel] = useState(null); // 'canvas' | 'tasks' | 'tools' | 'prompts'
  const [showShare, setShowShare] = useState(false);
  const [chatFontSize, setChatFontSize] = useState(getStoredFontSize);
  const [iconAttractor, setIconAttractor] = useState(null);
  const [promptQueue, setPromptQueue] = useState([]);
  const [sharedPromptQueue, setSharedPromptQueue] = useState([]);
  const [activeConversationRun, setActiveConversationRun] = useState(null);
  const [composerHeight, setComposerHeight] = useState(176);
  const scrollAreaRef = useRef(null);
  const autoScrollRef = useRef(true);
  const queueDrainRef = useRef(false);
  const previousConversationRef = useRef(currentConversationId);
  const autoOpenedWorkflowRef = useRef(null);

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
        isThinkingActive: Boolean(thinkingContent && !streamingContent),
        isStreaming: true,
      },
    ];
  }, [messages, streamingContent, thinkingContent, isGenerating]);
  const latestVisibleContent = displayMessages[displayMessages.length - 1]?.content || '';

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
  }, [composerHeight, displayMessages.length, latestVisibleContent, streamingContent, thinkingContent]);

  const handleComposerHeightChange = useCallback((height) => {
    setComposerHeight((current) => (Math.abs(current - height) > 1 ? height : current));
  }, []);

  useEffect(() => {
    const handler = () => setChatFontSize(getStoredFontSize());
    window.addEventListener('mira-preferences-changed', handler);
    return () => window.removeEventListener('mira-preferences-changed', handler);
  }, []);

  const sendToChat = useCallback((content, attachments, ws, options = {}) => {
    return sendMessage(content, attachments, ws, options);
  }, [sendMessage]);

  useEffect(() => {
    if (!activeProjectId || !currentConversationId) {
      setSharedPromptQueue([]);
      setActiveConversationRun(null);
      return undefined;
    }
    const unsubscribeQueue = subscribeConversationQueue(currentConversationId, setSharedPromptQueue);
    const unsubscribeRun = subscribeConversationRun(currentConversationId, setActiveConversationRun);
    return () => {
      unsubscribeQueue();
      unsubscribeRun();
    };
  }, [activeProjectId, currentConversationId]);

  const usingSharedQueue = Boolean(activeProjectId && currentConversationId);
  const visiblePromptQueue = usingSharedQueue ? sharedPromptQueue : promptQueue;
  const remoteRun = activeConversationRun?.author?.uid !== userProfile.uid ? activeConversationRun : null;

  const queuePrompt = useCallback((content, attachments, ws) => {
    const queued = createQueuedPrompt({
      content,
      attachments,
      webSearch: ws,
      conversationId: currentConversationId,
    });
    if (activeProjectId && currentConversationId) {
      return enqueueConversationPrompt(currentConversationId, queued, userProfile);
    }
    setPromptQueue((current) => enqueuePrompt(current, queued));
    return undefined;
  }, [activeProjectId, currentConversationId, userProfile]);

  const steerPrompt = useCallback((content, attachments, ws) => (
    sendToChat(content, attachments, ws, { interruptExisting: true, steering: true })
  ), [sendToChat]);

  const removePromptFromQueue = useCallback((promptId) => {
    if (usingSharedQueue) return removeConversationPrompt(currentConversationId, promptId, userProfile.uid);
    setPromptQueue((current) => removeQueuedPrompt(current, promptId));
    return undefined;
  }, [currentConversationId, userProfile.uid, usingSharedQueue]);

  const editPromptInQueue = useCallback((promptId, content) => {
    if (usingSharedQueue) return updateConversationPrompt(currentConversationId, promptId, userProfile.uid, { content });
    setPromptQueue((current) => updateQueuedPrompt(current, promptId, { content }));
    return undefined;
  }, [currentConversationId, userProfile.uid, usingSharedQueue]);

  const sendQueuedPromptNow = useCallback((promptId) => {
    const queued = visiblePromptQueue.find((prompt) => prompt.id === promptId);
    if (!queued) return;
    if (queued.author?.uid && queued.author.uid !== userProfile.uid) return;
    if (usingSharedQueue && activeConversationRun) return;
    if (usingSharedQueue) {
      queueDrainRef.current = true;
      return Promise.resolve(sendToChat(queued.content, queued.attachments, queued.webSearch, {
        queueOnBusy: false,
        author: queued.author || userProfile,
      })).then((result) => {
        if (!result?.queued) return removeConversationPrompt(currentConversationId, promptId, userProfile.uid);
        return undefined;
      }).finally(() => {
        queueDrainRef.current = false;
      });
    }
    setPromptQueue((current) => removeQueuedPrompt(current, promptId));
    if (queued.conversationId && queued.conversationId !== currentConversationId) return;
    return sendToChat(queued.content, queued.attachments, queued.webSearch, {
      interruptExisting: isGenerating,
      steering: isGenerating,
    });
  }, [activeConversationRun, currentConversationId, isGenerating, sendToChat, userProfile, usingSharedQueue, visiblePromptQueue]);

  useEffect(() => {
    if (usingSharedQueue) return;
    if (isGenerating || queueDrainRef.current || promptQueue.length === 0) return;
    const { next, remaining } = takeNextQueuedPrompt(promptQueue);
    if (!next) return;

    setPromptQueue(remaining);
    if (next.conversationId && next.conversationId !== currentConversationId) return;

    queueDrainRef.current = true;
    Promise.resolve(sendToChat(next.content, next.attachments, next.webSearch))
      .finally(() => {
        queueDrainRef.current = false;
      });
  }, [currentConversationId, isGenerating, promptQueue, sendToChat, usingSharedQueue]);

  useEffect(() => {
    if (!usingSharedQueue || isGenerating || activeConversationRun || queueDrainRef.current) return;
    const next = sharedPromptQueue[0];
    if (!next) return;
    queueDrainRef.current = true;
    Promise.resolve(sendToChat(next.content, next.attachments || [], next.webSearch, {
      queueOnBusy: false,
      author: next.author || userProfile,
    })).then((result) => {
      if (!result?.queued) return removeConversationPrompt(currentConversationId, next.id, next.author?.uid || userProfile.uid);
      return undefined;
    }).finally(() => {
      queueDrainRef.current = false;
    });
  }, [activeConversationRun, currentConversationId, isGenerating, sendToChat, sharedPromptQueue, userProfile, usingSharedQueue]);

  useEffect(() => {
    const previousConversationId = previousConversationRef.current;
    if (previousConversationId && previousConversationId !== currentConversationId) {
      setPromptQueue([]);
      queueDrainRef.current = false;
    }
    previousConversationRef.current = currentConversationId;
  }, [currentConversationId]);

  const requestCanvas = useCallback((prompt) => {
    if (!prompt?.trim()) return;
    sendToChat(prompt, [], false);
  }, [sendToChat]);

  const togglePanel = (name) => setPanel(p => p === name ? null : name);

  useEffect(() => {
    if (!taskWorkflow?.id || taskWorkflow.status !== 'running') return;
    if (autoOpenedWorkflowRef.current === taskWorkflow.id) return;
    autoOpenedWorkflowRef.current = taskWorkflow.id;
    setPanel('tasks');
  }, [taskWorkflow?.id, taskWorkflow?.status]);

  const showingWelcome = messages.length === 0;

  return (
    <div className="flex-1 flex min-h-0 relative">
      {/* Particle background — always rendered, scattered when messages appear */}
      {!showWorkspace && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <ParticleGlobe
            iconAttractor={iconAttractor}
            hasMessages={messages.length > 0}
          />
        </div>
      )}

      {showShare && <ShareModal messages={messages} title={messages[0]?.content?.slice(0, 50)} onClose={() => setShowShare(false)} />}

      <div className="flex flex-col flex-1 min-w-0 min-h-0 relative z-10">
        <div ref={scrollAreaRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden hud-scroll-area" style={{ fontSize: chatFontSize }}>
          <div
            className={`max-w-4xl mx-auto flex flex-col ${showingWelcome ? 'justify-center' : 'justify-end'} min-h-full pt-24 gap-6 px-4 w-full min-w-0`}
            style={{ paddingBottom: `${Math.max(216, composerHeight + 40)}px` }}
          >
            {showingWelcome && showWorkspace ? (
              <div className="desktop-workspace-chat-empty">
                <strong>Workspace assistant</strong>
                <span>Open a folder, then ask MIRA to inspect, edit, or test the project.</span>
              </div>
            ) : showingWelcome ? (
              <WelcomeScreen
                onSend={(p, atts = []) => sendToChat(p, atts, webSearch)}
                onIconHover={setIconAttractor}
              />
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
                  taskWorkflow={isGenerating && i === displayMessages.length - 1 ? taskWorkflow : null}
                  userProfile={userProfile}
                />
              ))
            )}
          </div>
        </div>

        <ChatInput
          onSend={(text, attachments, options = {}) => sendToChat(text, attachments, webSearch, options)}
          onQueue={(text, attachments) => queuePrompt(text, attachments, webSearch)}
          onSteer={(text, attachments) => steerPrompt(text, attachments, webSearch)}
          onStop={stopGenerating}
          isGenerating={isGenerating}
          isConversationBusy={Boolean(remoteRun)}
          busyUser={remoteRun?.author}
          isSearching={isSearching}
          webSearch={webSearch}
          onToggleWebSearch={() => setWebSearch(v => !v)}
          activePanel={panel}
          onTogglePanel={togglePanel}
          onShare={() => setShowShare(true)}
          messages={messages}
          queuedPrompts={visiblePromptQueue}
          queueLimitReached={visiblePromptQueue.length >= MAX_PROMPT_QUEUE}
          currentUserId={userProfile.uid}
          onRemoveQueued={removePromptFromQueue}
          onEditQueued={editPromptInQueue}
          onSendQueuedNow={sendQueuedPromptNow}
          onHeightChange={handleComposerHeightChange}
        />
      </div>

      {panel === 'canvas' && (
        <RightPanel id="canvas" defaultWidth={480} minWidth={320} maxWidth={1000} workspaceMode={showWorkspace} onClose={() => setPanel(null)}>
          <CanvasPanel messages={messages} onClose={() => setPanel(null)} onRequestCanvas={requestCanvas} />
        </RightPanel>
      )}
      {panel === 'tasks' && (
        <RightPanel id="tasks" defaultWidth={360} minWidth={280} maxWidth={720} workspaceMode={showWorkspace} onClose={() => setPanel(null)}>
          <TaskRunner
            workflow={taskWorkflow}
            onStop={stopGenerating}
            onClearWorkflow={clearTaskWorkflow}
            onSendMessage={(content, goal) => {
              setPanel(null);
              const prompt = `Present the completed Task Runner output below as the final answer. Preserve all useful results, remove process chatter, and do not rerun completed steps.\n\n${content}`;
              sendToChat(`Task Runner completed: ${goal}`, [], false, {
                promptContent: prompt,
              });
            }}
            onClose={() => setPanel(null)}
          />
        </RightPanel>
      )}
      {panel === 'tools' && (
        <RightPanel id="tools" defaultWidth={320} minWidth={260} maxWidth={620} workspaceMode={showWorkspace} onClose={() => setPanel(null)}>
          <ToolsPanel
            onPublish={(toolName, result) => {
              setPanel(null);
              const prompt = `A ${toolName} tool completed with the result below. Present it clearly as the final answer, preserve exact values and errors, and add only directly useful explanation.\n\n${result}`;
              sendToChat(`${toolName} result:\n${result}`, [], false, {
                promptContent: prompt,
              });
            }}
            onClose={() => setPanel(null)}
          />
        </RightPanel>
      )}
      {panel === 'prompts' && (
        <RightPanel id="prompts" defaultWidth={340} minWidth={280} maxWidth={680} workspaceMode={showWorkspace} onClose={() => setPanel(null)}>
          <PromptLibrary onUsePrompt={(p) => { sendToChat(p, [], webSearch); setPanel(null); }} onClose={() => setPanel(null)} />
        </RightPanel>
      )}
    </div>
  );
}
