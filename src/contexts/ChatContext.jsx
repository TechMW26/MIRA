import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { stopChatGeneration } from '../services/api';
import { buildChatPath, parseChatRoute } from '../services/chatRoutes.js';
import { waitForConversationRoute } from '../services/chatStartup.js';

const ChatContext = createContext(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}

export function ChatProvider({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const chatRoute = useMemo(
    () => parseChatRoute(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const routeRef = useRef(chatRoute);
  routeRef.current = chatRoute;
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStartingChat, setIsStartingChat] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [pendingConversationId, setPendingConversationId] = useState(null);
  const pendingConversationIdRef = useRef(null);
  // Tracks which projects have been PIN-unlocked this session
  const [unlockedProjects, setUnlockedProjects] = useState(new Set());

  const commitChatRoute = useCallback((next, { replace = false } = {}) => {
    const route = {
      managed: true,
      projectId: next.projectId || null,
      conversationId: next.conversationId || null,
      legacy: false,
    };
    routeRef.current = route;
    navigate(buildChatPath(route), { replace });
  }, [navigate]);

  const setCurrentConversationId = useCallback((value) => {
    const current = routeRef.current;
    const conversationId = typeof value === 'function'
      ? value(current.conversationId)
      : value;
    if ((conversationId || null) !== (current.conversationId || null)) {
      stopChatGeneration();
      setIsGenerating(false);
      setIsStartingChat(false);
      setIsSearching(false);
      window.dispatchEvent(new CustomEvent('mira:chat-route-changing'));
    }
    if (pendingConversationIdRef.current !== conversationId) {
      pendingConversationIdRef.current = null;
      setPendingConversationId(null);
    }
    commitChatRoute({
      projectId: current.projectId,
      conversationId: conversationId || null,
    });
  }, [commitChatRoute]);

  const reserveConversationRoute = useCallback(async (conversationId) => {
    const id = String(conversationId || '').trim();
    if (!id) throw new Error('A conversation ID is required before starting chat.');
    const route = {
      projectId: routeRef.current.projectId || null,
      conversationId: id,
    };
    pendingConversationIdRef.current = id;
    setPendingConversationId(id);
    commitChatRoute(route);
    await waitForConversationRoute(() => routeRef.current, route);
    return id;
  }, [commitChatRoute]);

  const confirmConversationRoute = useCallback((conversationId) => {
    const id = String(conversationId || '').trim();
    if (!id || pendingConversationIdRef.current !== id) return;
    pendingConversationIdRef.current = null;
    setPendingConversationId(null);
  }, []);

  const setActiveProjectId = useCallback((value) => {
    const current = routeRef.current;
    const projectId = typeof value === 'function' ? value(current.projectId) : value;
    if ((projectId || null) !== (current.projectId || null)) {
      stopChatGeneration();
      setIsGenerating(false);
      setIsStartingChat(false);
      setIsSearching(false);
      window.dispatchEvent(new CustomEvent('mira:chat-route-changing'));
    }
    commitChatRoute({
      projectId: projectId || null,
      conversationId: projectId === current.projectId ? current.conversationId : null,
    });
  }, [commitChatRoute]);

  useEffect(() => {
    if (!chatRoute.legacy) return;
    commitChatRoute(chatRoute, { replace: true });
  }, [chatRoute, commitChatRoute]);

  useEffect(() => {
    const handleWorkspaceChanged = () => {
      stopChatGeneration();
      setIsGenerating(false);
      setIsStartingChat(false);
      setIsSearching(false);
      window.dispatchEvent(new CustomEvent('mira:chat-route-changing'));
      commitChatRoute({ projectId: null, conversationId: null });
    };
    window.addEventListener('mira:workspace-changed', handleWorkspaceChanged);
    return () => window.removeEventListener('mira:workspace-changed', handleWorkspaceChanged);
  }, [commitChatRoute]);

  const currentConversationId = chatRoute.managed ? chatRoute.conversationId : null;
  const activeProjectId = chatRoute.managed ? chatRoute.projectId : null;

  const startNewChat = useCallback(() => {
    stopChatGeneration();
    setIsGenerating(false);
    setIsStartingChat(false);
    setIsSearching(false);
    pendingConversationIdRef.current = null;
    setPendingConversationId(null);
    window.dispatchEvent(new CustomEvent('mira:chat-route-changing'));
    commitChatRoute({
      projectId: routeRef.current.projectId,
      conversationId: null,
    });
  }, [commitChatRoute]);

  const unlockProject = useCallback((projectId) => {
    setUnlockedProjects((prev) => new Set(prev).add(projectId));
  }, []);

  const isProjectUnlocked = useCallback((projectId) => {
    return unlockedProjects.has(projectId);
  }, [unlockedProjects]);

  const value = {
    currentConversationId,
    setCurrentConversationId,
    reserveConversationRoute,
    confirmConversationRoute,
    pendingConversationId,
    isGenerating,
    setIsGenerating,
    isStartingChat,
    setIsStartingChat,
    isSearching,
    setIsSearching,
    sidebarOpen,
    setSidebarOpen,
    showSettings,
    setShowSettings,
    showWorkspace,
    setShowWorkspace,
    startNewChat,
    activeProjectId,
    setActiveProjectId,
    unlockProject,
    isProjectUnlocked,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
