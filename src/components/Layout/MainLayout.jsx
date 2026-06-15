import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useChatContext } from '../../contexts/ChatContext';
import Sidebar from '../Sidebar/Sidebar';
import ChatWindow from '../Chat/ChatWindow';
import HudOverlay from '../Chat/HudOverlay';
import SettingsModal from '../Profile/ProfilePage';

export default function MainLayout() {
  const {
    showSettings,
    setShowSettings,
    currentConversationId,
    setCurrentConversationId,
    activeProjectId,
    setActiveProjectId,
    selectedModel,
  } = useChatContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const hasHydratedFromUrlRef = useRef(false);

  useEffect(() => {
    document.body.classList.add('mira-hud', 'mira-hud-active');
    return () => {
      document.body.classList.remove('mira-hud', 'mira-hud-active');
    };
  }, []);

  useEffect(() => {
    if (selectedModel === 'locked') {
      document.body.setAttribute('data-locked', 'true');
    } else {
      document.body.removeAttribute('data-locked');
    }
    return () => document.body.removeAttribute('data-locked');
  }, [selectedModel]);

  // URL -> state sync (supports opening direct permalinks and browser back/forward).
  // We complete this hydration before allowing state -> URL writes to avoid first-load
  // races that can force stale `?c=` params back onto `/`.
  useEffect(() => {
    const urlConversationId = searchParams.get('c') || null;
    const urlProjectId = searchParams.get('p') || null;

    setCurrentConversationId(urlConversationId);
    setActiveProjectId(urlProjectId);
    hasHydratedFromUrlRef.current = true;
  }, [searchParams, setCurrentConversationId, setActiveProjectId]);

  // State -> URL sync (ensures every chat has a shareable permalink).
  useEffect(() => {
    if (!hasHydratedFromUrlRef.current) return;

    const next = new URLSearchParams(searchParams);
    let changed = false;

    if (currentConversationId) {
      if (next.get('c') !== currentConversationId) {
        next.set('c', currentConversationId);
        changed = true;
      }
    } else if (next.has('c')) {
      next.delete('c');
      changed = true;
    }

    if (activeProjectId) {
      if (next.get('p') !== activeProjectId) {
        next.set('p', activeProjectId);
        changed = true;
      }
    } else if (next.has('p')) {
      next.delete('p');
      changed = true;
    }

    if (changed) {
      setSearchParams(next, { replace: true });
    }
  }, [currentConversationId, activeProjectId, searchParams, setSearchParams]);

  return (
    <div className="relative flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
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
