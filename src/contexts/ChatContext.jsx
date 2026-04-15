import { createContext, useContext, useState, useCallback } from 'react';

const ChatContext = createContext(null);

export function useChatContext() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChatContext must be used within ChatProvider');
  return ctx;
}

export function ChatProvider({ children }) {
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [model, setModel] = useState('gemini-2.5-flash');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const startNewChat = useCallback(() => {
    setCurrentConversationId(null);
  }, []);

  const value = {
    currentConversationId,
    setCurrentConversationId,
    isGenerating,
    setIsGenerating,
    model,
    setModel,
    sidebarOpen,
    setSidebarOpen,
    startNewChat,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
