import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { stopChatGeneration } from '../services/api';
import { buildChatPath, parseChatRoute } from '../services/chatRoutes.js';

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
  const [isSearching, setIsSearching] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
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
    commitChatRoute({
      projectId: current.projectId,
      conversationId: conversationId || null,
    });
  }, [commitChatRoute]);

  const setActiveProjectId = useCallback((value) => {
    const current = routeRef.current;
    const projectId = typeof value === 'function' ? value(current.projectId) : value;
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
      commitChatRoute({ projectId: null, conversationId: null });
    };
    window.addEventListener('mira:workspace-changed', handleWorkspaceChanged);
    return () => window.removeEventListener('mira:workspace-changed', handleWorkspaceChanged);
  }, [commitChatRoute]);

  const currentConversationId = chatRoute.managed ? chatRoute.conversationId : null;
  const activeProjectId = chatRoute.managed ? chatRoute.projectId : null;

  const startNewChat = useCallback(() => {
    stopChatGeneration();
    setCurrentConversationId(null);
  }, [setCurrentConversationId]);

  const unlockProject = useCallback((projectId) => {
    setUnlockedProjects((prev) => new Set(prev).add(projectId));
  }, []);

  const isProjectUnlocked = useCallback((projectId) => {
    return unlockedProjects.has(projectId);
  }, [unlockedProjects]);

  const value = {
    currentConversationId,
    setCurrentConversationId,
    isGenerating,
    setIsGenerating,
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
