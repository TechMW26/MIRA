import { useEffect } from 'react';
import { useChatContext } from '../../contexts/ChatContext';
import Sidebar from '../Sidebar/Sidebar';
import ChatWindow from '../Chat/ChatWindow';
import HudOverlay from '../Chat/HudOverlay';
import SettingsModal from '../Profile/ProfilePage';

export default function MainLayout() {
  const { showSettings, setShowSettings, isGenerating, isSearching } = useChatContext();

  useEffect(() => {
    document.body.classList.add('mira-hud', 'mira-hud-active');
    return () => {
      document.body.classList.remove('mira-hud', 'mira-hud-active');
    };
  }, []);

  const status = isSearching ? 'SEARCHING' : isGenerating ? 'PROCESSING' : 'READY';

  return (
    <div className="relative flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        <HudOverlay status={status} model="MIRA v2.5" />

        <div className="flex-1 min-h-0 flex flex-col">
          <ChatWindow />
        </div>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
