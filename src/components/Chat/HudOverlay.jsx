import { Code2, Menu, X } from 'lucide-react';
import { useChatContext } from '../../contexts/ChatContext';

/**
 * HudOverlay — controls around the chat surface. Mira's expressive identity
 * owns the former top-brand space; bottom chrome is handled by the composer.
 */
export default function HudOverlay() {
  const { sidebarOpen, setSidebarOpen, showWorkspace, setShowWorkspace } = useChatContext();
  const isDesktop = typeof window !== 'undefined' && Boolean(window.miraDesktop);

  return (
    <>
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
