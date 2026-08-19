import { useEffect, useState } from 'react';
import { ExternalLink, RefreshCw, X } from 'lucide-react';
import { normalizeLocalPreviewUrl } from '../../services/localPreview.js';

const EDGE_PARTICLE_COUNT = 52;
const CENTER_PARTICLE_COUNT = 10;

const ambientParticles = Array.from({ length: EDGE_PARTICLE_COUNT + CENTER_PARTICLE_COUNT }, (_, index) => {
  const onEdge = index < EDGE_PARTICLE_COUNT;
  const side = index % 4;
  const along = 3 + ((index * 37) % 94);
  const inset = 1 + ((index * 17) % 10);
  let x = 20 + ((index * 29) % 61);
  let y = 20 + ((index * 43) % 61);

  if (onEdge) {
    if (side === 0) { x = along; y = inset; }
    if (side === 1) { x = 100 - inset; y = along; }
    if (side === 2) { x = along; y = 100 - inset; }
    if (side === 3) { x = inset; y = along; }
  }

  const opacity = onEdge ? 0.18 + (index % 5) * 0.055 : 0.08 + (index % 3) * 0.025;
  return {
    '--browser-particle-x': `${x}%`,
    '--browser-particle-y': `${y}%`,
    '--browser-particle-size': `${onEdge ? 1.2 + (index % 4) * 0.45 : 0.7 + (index % 3) * 0.2}px`,
    '--browser-particle-opacity': opacity,
    '--browser-particle-min-opacity': opacity * 0.62,
    '--browser-particle-end-opacity': opacity * 0.78,
    '--browser-particle-delay': `${-((index * 0.47) % 8)}s`,
    '--browser-particle-duration': `${7 + (index % 6) * 1.3}s`,
    '--browser-particle-drift-x': `${((index * 11) % 9) - 4}px`,
    '--browser-particle-drift-y': `${((index * 7) % 9) - 4}px`,
  };
});

export default function WorkspaceBrowser({ initialUrl, onClose }) {
  const [input, setInput] = useState(initialUrl || 'http://localhost:3000');
  const [url, setUrl] = useState(normalizeLocalPreviewUrl(initialUrl) || '');
  const [frameKey, setFrameKey] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    const next = normalizeLocalPreviewUrl(initialUrl);
    if (!next) return;
    setInput(next);
    setUrl(next);
    setFrameKey((current) => current + 1);
  }, [initialUrl]);

  function navigate(event) {
    event?.preventDefault();
    const next = normalizeLocalPreviewUrl(input);
    if (!next) {
      setError('Only localhost and loopback HTTP links can open inside the workspace browser.');
      return;
    }
    setError('');
    setUrl(next);
    setInput(next);
    setFrameKey((current) => current + 1);
  }

  return (
    <section className="desktop-local-browser" aria-label="Local application preview">
      <form className="desktop-browser-toolbar" onSubmit={navigate}>
        <span className="desktop-browser-dot" aria-hidden="true" />
        <input value={input} onChange={(event) => setInput(event.target.value)} aria-label="Local preview URL" placeholder="http://localhost:3000" />
        <button type="submit">Open</button>
        <button type="button" onClick={() => setFrameKey((current) => current + 1)} disabled={!url} aria-label="Reload preview"><RefreshCw size={14} /></button>
        <a href={url || '#'} target="_blank" rel="noreferrer" aria-label="Open preview externally"><ExternalLink size={14} /></a>
        <button type="button" onClick={onClose} aria-label="Close local preview"><X size={14} /></button>
      </form>
      {error && <p className="desktop-browser-error" role="alert">{error}</p>}
      <div className="desktop-browser-viewport">
        {url ? (
          window.miraDesktop?.bridgeVersion >= 5 ? (
            <webview
              key={`${url}:${frameKey}`}
              src={url}
              title={`Local preview: ${url}`}
              partition="mira-local-preview"
            />
          ) : (
            <iframe
              key={`${url}:${frameKey}`}
              src={url}
              title={`Local preview: ${url}`}
              sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
              referrerPolicy="no-referrer"
            />
          )
        ) : (
          <div className="desktop-preview-empty">Start a local development server, then open its terminal link here.</div>
        )}
        <div className="desktop-browser-ambient" aria-hidden="true">
          <span className="desktop-browser-edge-tint" />
          {ambientParticles.map((style, index) => (
            <span key={index} className="desktop-browser-particle" style={style} />
          ))}
        </div>
      </div>
    </section>
  );
}
