import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const ACTIVE_CONVERSATION_STORAGE_KEY = 'mira_active_conversation_id';
const ACTIVE_PROJECT_STORAGE_KEY = 'mira_active_project_id';

const ChatContext = createContext(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}

export function ChatProvider({ children }) {
  const [currentConversationId, setCurrentConversationId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(() => {
    try {
      return localStorage.getItem(ACTIVE_PROJECT_STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });
  // Tracks which projects have been PIN-unlocked this session
  const [unlockedProjects, setUnlockedProjects] = useState(new Set());

  const startNewChat = useCallback(() => {
    setCurrentConversationId(null);
  }, []);

  useEffect(() => {
    try {
      if (currentConversationId) {
        localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, currentConversationId);
      } else {
        localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [currentConversationId]);

  useEffect(() => {
    try {
      if (activeProjectId) {
        localStorage.setItem(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId);
      } else {
        localStorage.removeItem(ACTIVE_PROJECT_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [activeProjectId]);

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
    startNewChat,
    activeProjectId,
    setActiveProjectId,
    unlockProject,
    isProjectUnlocked,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
