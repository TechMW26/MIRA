import React from 'react';
import { Menu, X } from 'lucide-react';
import { useChatContext } from '../../contexts/ChatContext';

/**
 * HudOverlay — chrome around the chat surface. Top row carries the
 * ONLINE chip, MIRA brand block, settings button and clock on a single
 * 38px-tall baseline. Bottom chrome is now handled by the composer dock glow.
 */
export default function HudOverlay() {
  const { sidebarOpen, setSidebarOpen } = useChatContext();

  return (
    <>
      <div className="hud-top-dock pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-center px-4 pb-4">
        <div className="hud-brand-frame select-none">
          <div className="hud-bracket-row">
            <span className="hud-bracket hud-bracket-left" />
            <h1 className="mira-hero-title">MIRA</h1>
            <span className="hud-bracket hud-bracket-right" />
          </div>
          <span className="mira-hero-sub">AI ASSISTANT</span>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="sidebar-mobile-trigger"
        title={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
      </button>

    </>
  );
}
