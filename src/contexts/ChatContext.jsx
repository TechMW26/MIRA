import { createContext, useContext, useState, useCallback, useEffect } from 'react';

const SELECTED_MODEL_STORAGE_KEY = 'mira_selected_model';
const ALLOWED_MODELS = new Set(['auto', 'mira-pro', 'mira', 'locked']);
const LOCKED_MODEL_PIN = '1512';

const ChatContext = createContext(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}

export function ChatProvider({ children }) {
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(null);
  // Tracks which projects have been PIN-unlocked this session
  const [unlockedProjects, setUnlockedProjects] = useState(new Set());
  // Session-only unlock for the Unrestricted locked model
  const [lockedModelUnlocked, setLockedModelUnlocked] = useState(false);
  const [selectedModel, setSelectedModelState] = useState(() => {
    try {
      const stored = localStorage.getItem(SELECTED_MODEL_STORAGE_KEY);
      return stored && ALLOWED_MODELS.has(stored) ? stored : 'auto';
    } catch {
      return 'auto';
    }
  });
  const [activeResponseModel, setActiveResponseModel] = useState(null);

  const setSelectedModel = useCallback((value) => {
    const next = ALLOWED_MODELS.has(value) ? value : 'auto';
    setSelectedModelState(next);
    try {
      localStorage.setItem(SELECTED_MODEL_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }, []);

  const startNewChat = useCallback(() => {
    setCurrentConversationId(null);
  }, []);

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
    selectedModel,
    setSelectedModel,
    activeResponseModel,
    setActiveResponseModel,
    lockedModelUnlocked,
    setLockedModelUnlocked,
    LOCKED_MODEL_PIN,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
