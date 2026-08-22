import { useEffect, useRef, useState } from 'react';
import { Maximize2, Minus } from 'lucide-react';
import ChatWindow from '../Chat/ChatWindow';
import MiraBloub from '../Chat/MiraBloub';
import { useChatContext } from '../../contexts/ChatContext';
import { useAuth } from '../../contexts/AuthContext';

const DRAG_THRESHOLD = 5;

export default function DesktopCompanion() {
  const { setShowWorkspace } = useChatContext();
  const { user, loading } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const dragRef = useRef(null);

  useEffect(() => {
    setShowWorkspace(false);
    document.body.classList.add('desktop-companion-mode');
    const unsubscribe = window.miraDesktop?.onCompanionState?.((state) => {
      setExpanded(Boolean(state?.expanded));
    });
    return () => {
      document.body.classList.remove('desktop-companion-mode');
      unsubscribe?.();
    };
  }, [setShowWorkspace]);

  const updateExpanded = async (next) => {
    setExpanded(next);
    await window.miraDesktop?.setCompanionExpanded?.(next);
  };

  const openFullApp = async () => {
    await updateExpanded(false);
    await window.miraDesktop?.openMainWindow?.();
  };

  const handlePointerDown = (event) => {
    if (expanded || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.screenX, y: event.screenY, moved: false };
  };

  const handlePointerMove = (event) => {
    const drag = dragRef.current;
    if (!drag || expanded) return;
    const deltaX = event.screenX - drag.x;
    const deltaY = event.screenY - drag.y;
    if (Math.hypot(deltaX, deltaY) >= DRAG_THRESHOLD) drag.moved = true;
    if (!deltaX && !deltaY) return;
    drag.x = event.screenX;
    drag.y = event.screenY;
    window.miraDesktop?.moveCompanion?.({ deltaX, deltaY });
  };

  const handlePointerUp = () => {
    const moved = dragRef.current?.moved;
    dragRef.current = null;
    if (!moved) updateExpanded(true);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        className="desktop-companion-pet"
        aria-label="Open MIRA mini chat"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <MiraBloub variant="companion" expression="attentive" activity="idle" />
      </button>
    );
  }

  return (
    <main className="desktop-companion-window">
      <header>
        <strong>MIRA</strong>
        <div>
          <button type="button" onClick={openFullApp} aria-label="Open full MIRA"><Maximize2 size={15} /></button>
          <button type="button" onClick={() => updateExpanded(false)} aria-label="Collapse mini chat"><Minus size={16} /></button>
        </div>
      </header>
      {user ? <ChatWindow compact /> : (
        <section className="desktop-companion-signin">
          <MiraBloub variant="companion" expression="attentive" activity={loading ? 'thinking' : 'idle'} />
          <strong>{loading ? 'Getting ready…' : 'Your MIRA pet is ready'}</strong>
          <p>{loading ? 'Restoring your desktop session.' : 'Open the full app to sign in, then chat with MIRA here.'}</p>
          {!loading && <button type="button" onClick={openFullApp}>Open MIRA</button>}
        </section>
      )}
    </main>
  );
}
