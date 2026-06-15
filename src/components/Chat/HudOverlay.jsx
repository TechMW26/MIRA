import { useEffect, useState } from 'react';
import { Clock, Menu, Settings } from 'lucide-react';
import { useChatContext } from '../../contexts/ChatContext';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * HudOverlay — chrome around the chat surface. Top row carries the
 * ONLINE chip, MIRA brand block, settings button and clock on a single
 * 38px-tall baseline. Bottom chrome is now handled by the composer dock glow.
 */
export default function HudOverlay() {
  const now = useClock();
  const { sidebarOpen, setSidebarOpen, setShowSettings } = useChatContext();

  return (
    <>
      <div className="hud-top-dock pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-5 pt-5 pb-6">
        <div className="pointer-events-auto flex items-center gap-3">
          {!sidebarOpen && (
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="hud-btn"
              title="Open sidebar"
              aria-label="Open sidebar"
              style={{ height: 38, width: 38 }}
            >
              <Menu size={16} />
            </button>
          )}
          <div className="hud-chip">
            <span className="hud-chip-dot" />
            ONLINE
          </div>
        </div>

        <div className="hud-brand-frame select-none">
          <div className="hud-bracket-row">
            <span className="hud-bracket hud-bracket-left" />
            <h1 className="mira-hero-title">MIRA</h1>
            <span className="hud-bracket hud-bracket-right" />
          </div>
          <span className="mira-hero-sub">AI ASSISTANT</span>
        </div>

        <div className="pointer-events-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="hud-btn"
            title="Settings"
            style={{ height: 38, width: 38 }}
          >
            <Settings size={16} />
          </button>
          <div className="hud-chip">
            {formatTime(now)}
            <Clock size={12} style={{ marginLeft: 4 }} />
          </div>
        </div>
      </div>

    </>
  );
}
