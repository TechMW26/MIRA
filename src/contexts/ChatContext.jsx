import { createContext, useContext, useState, useCallback } from 'react';
import { stopChatGeneration } from '../services/api';

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
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [activeProjectId, setActiveProjectId] = useState(null);
  // Tracks which projects have been PIN-unlocked this session
  const [unlockedProjects, setUnlockedProjects] = useState(new Set());
  const startNewChat = useCallback(() => {
    stopChatGeneration();
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
