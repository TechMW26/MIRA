import React from 'react';
import { Code2, Menu, X } from 'lucide-react';
import { useChatContext } from '../../contexts/ChatContext';
import MiraLogo from '../common/MiraLogo';

/**
 * HudOverlay — chrome around the chat surface. Top row carries the
 * ONLINE chip, MIRA brand block, settings button and clock on a single
 * 38px-tall baseline. Bottom chrome is now handled by the composer dock glow.
 */
export default function HudOverlay() {
  const { sidebarOpen, setSidebarOpen, showWorkspace, setShowWorkspace } = useChatContext();
  const isDesktop = typeof window !== 'undefined' && Boolean(window.miraDesktop);

  return (
    <>
      <div className="hud-top-dock pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-center px-4 pb-4">
        <div className="hud-brand-frame select-none" style={{ color: 'var(--hud-cyan-bright)' }}>
          <MiraLogo size={34} wordmark />
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

      {isDesktop && (
        <button
          type="button"
          onClick={() => setShowWorkspace(!showWorkspace)}
          className="desktop-workspace-trigger"
          title={showWorkspace ? 'Close workspace' : 'Open workspace IDE'}
          aria-label={showWorkspace ? 'Close workspace IDE' : 'Open workspace IDE'}
          aria-pressed={showWorkspace}
        >
          <Code2 size={17} />
          <span>Workspace</span>
        </button>
      )}

    </>
  );
}
