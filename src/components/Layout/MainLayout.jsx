import { useEffect } from 'react';
import { Menu } from 'lucide-react';
import { useChatContext } from '../../contexts/ChatContext';
import Sidebar from '../Sidebar/Sidebar';
import ChatWindow from '../Chat/ChatWindow';
import SettingsModal from '../Profile/ProfilePage';
import { getUserMemories } from '../../services/database';

export default function MainLayout() {
  const { sidebarOpen, setSidebarOpen, showSettings, setShowSettings } = useChatContext();

  // Preload memories to localStorage so the engine has them from the start
  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('mira_user') || 'null');
    if (user?.uid) {
      getUserMemories(user.uid).then((mems) => {
        localStorage.setItem('mira_memories', JSON.stringify((mems || []).map((m) => m.content)));
      });
    }
  }, []);

  return (
    <div className="relative flex h-screen overflow-hidden" style={{ background: 'var(--bg-primary)' }}>

      {/* Sidebar */}
      <Sidebar />

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {/* Top bar (when sidebar closed) */}
        {!sidebarOpen && (
          <div className="flex items-center gap-3 px-4 py-3 glass-subtle m-3 mb-0 rounded-2xl animate-fade-in">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 rounded-xl transition-all duration-200 hover:scale-105"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Menu size={20} />
            </button>
            <img src="/mira-logo.png" alt="MIRA" className="w-7 h-7 rounded-lg object-cover" />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>MIRA</span>
          </div>
        )}

        {/* Chat */}
        <ChatWindow />
      </div>

      {/* Settings modal */}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
