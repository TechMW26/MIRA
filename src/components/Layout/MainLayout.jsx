import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChatContext } from '../../contexts/ChatContext';
import Sidebar from '../Sidebar/Sidebar';
import ChatWindow from '../Chat/ChatWindow';
import HudOverlay from '../Chat/HudOverlay';
import SettingsModal from '../Profile/ProfilePage';
import { stopChatGeneration } from '../../services/api';

export default function MainLayout() {
  const {
    showSettings,
    setShowSettings,
    currentConversationId,
    setCurrentConversationId,
    activeProjectId,
    setActiveProjectId,
    selectedModel,
    activeResponseModel,
  } = useChatContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasResetSessionRef = useRef(false);

  useEffect(() => {
    document.body.classList.add('mira-hud', 'mira-hud-active');
    return () => {
      document.body.classList.remove('mira-hud', 'mira-hud-active');
    };
  }, []);

  useEffect(() => {
    if (selectedModel === 'locked' || activeResponseModel === 'locked') {
      document.body.setAttribute('data-locked', 'true');
    } else {
      document.body.removeAttribute('data-locked');
    }
    return () => document.body.removeAttribute('data-locked');
  }, [selectedModel, activeResponseModel]);

  // App reopen should always start a fresh session.
  useEffect(() => {
    if (hasResetSessionRef.current) return;
    hasResetSessionRef.current = true;

    stopChatGeneration();
    setCurrentConversationId(null);
    setActiveProjectId(null);

    const next = new URLSearchParams(searchParams);
    let changed = false;
    if (next.has('c')) {
      next.delete('c');
      changed = true;
    }
    if (next.has('p')) {
      next.delete('p');
      changed = true;
    }

    if (changed) {
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams, setCurrentConversationId, setActiveProjectId]);

  return (
    <div className="app-shell relative flex overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <HudOverlay />

        <div className="flex-1 min-h-0 flex flex-col">
          <ChatWindow />
        </div>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
