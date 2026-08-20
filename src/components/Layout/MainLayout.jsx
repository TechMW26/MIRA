import { useEffect, useRef, useState } from 'react';
import { useChatContext } from '../../contexts/ChatContext';
import Sidebar from '../Sidebar/Sidebar';
import ChatWindow from '../Chat/ChatWindow';
import HudOverlay from '../Chat/HudOverlay';
import MiraBloub from '../Chat/MiraBloub';
import SettingsModal from '../Profile/ProfilePage';
import DesktopWorkspace from '../Desktop/DesktopWorkspace';

export default function MainLayout() {
  const {
    showSettings,
    setShowSettings,
    showWorkspace,
  } = useChatContext();
  const workspaceSplitRef = useRef(null);
  const [workspacePercent, setWorkspacePercent] = useState(() => Number(localStorage.getItem('mira_workspace_width_percent')) || 58);
  const [desktopMiraExpression, setDesktopMiraExpression] = useState('neutral');

  function startWorkspaceResize(event) {
    event.preventDefault();
    const bounds = workspaceSplitRef.current?.getBoundingClientRect();
    if (!bounds?.width) return;
    const onMove = (moveEvent) => {
      const next = Math.max(32, Math.min(76, ((moveEvent.clientX - bounds.left) / bounds.width) * 100));
      setWorkspacePercent(next);
      localStorage.setItem('mira_workspace_width_percent', String(next));
    };
    const onUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function resizeWorkspaceWithKeyboard(event) {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const next = Math.max(32, Math.min(76, workspacePercent + (event.key === 'ArrowRight' ? 2 : -2)));
    setWorkspacePercent(next);
    localStorage.setItem('mira_workspace_width_percent', String(next));
  }

  useEffect(() => {
    document.body.classList.add('mira-hud', 'mira-hud-active');
    return () => {
      document.body.classList.remove('mira-hud', 'mira-hud-active');
    };
  }, []);

  return (
    <div className="app-shell relative flex overflow-hidden" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 relative z-10">
        {showWorkspace && (
          <MiraBloub
            expression={desktopMiraExpression}
            expanded
            variant="desktop"
          />
        )}
        <HudOverlay />

        <div ref={workspaceSplitRef} className={`flex-1 min-h-0 flex ${showWorkspace ? 'desktop-workspace-split' : 'flex-col'}`}>
          {showWorkspace && <DesktopWorkspace style={{ flex: `0 0 ${workspacePercent}%` }} />}
          {showWorkspace && <div className="desktop-workspace-resizer" onMouseDown={startWorkspaceResize} onKeyDown={resizeWorkspaceWithKeyboard} role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize workspace and chat" />}
          <div className={`min-h-0 min-w-0 flex flex-col ${showWorkspace ? 'desktop-chat-pane' : 'flex-1'}`} style={showWorkspace ? { flex: '1 1 0' } : undefined}>
            <ChatWindow onMiraExpressionChange={showWorkspace ? setDesktopMiraExpression : undefined} />
          </div>
        </div>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
