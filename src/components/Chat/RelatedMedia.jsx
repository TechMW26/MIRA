import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Play, ExternalLink, X, ImageIcon } from 'lucide-react';

// Proxy through our own image endpoint so foreign CDNs (which often block
// hot-linking with referer checks) still render in <img>.
function viaProxy(url) {
  if (!url) return url;
  return `/api/image?url=${encodeURIComponent(url)}`;
}

function isYouTube(item) {
  return item?.platform === 'youtube' || (typeof item?.embed === 'string' && /youtube\.com\/embed/.test(item.embed));
}

function isInstagram(item) {
  return item?.platform === 'instagram' || (typeof item?.embed === 'string' && /instagram\.com\/(p|reel)\//.test(item.embed));
}

function platformLabel(item) {
  if (isYouTube(item)) return 'YouTube';
  if (isInstagram(item)) return 'Instagram';
  return 'Source';
}

function MediaThumb({ item, kind, onOpen }) {
  const [errored, setErrored] = useState(false);
  const rawThumb = item.thumbnail || item.url;
  const src = errored ? viaProxy(rawThumb) : rawThumb;
  const showInstagramFallback = kind === 'video' && isInstagram(item) && !rawThumb;

  return (
    <button
      type="button"
      onClick={() => onOpen(item, kind)}
      className="group relative flex-shrink-0 overflow-hidden rounded-xl border transition-all hover:scale-[1.02] hover:shadow-lg"
      style={{
        width: 156,
        height: 96,
        borderColor: 'var(--border)',
        background: 'var(--glass-bg)',
      }}
      title={item.title || (kind === 'video' ? 'Open video' : 'Open image')}
    >
      {src ? (
        <img
          src={src}
          alt={item.title || ''}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={(e) => {
            if (!errored) {
              setErrored(true);
            } else {
              e.currentTarget.style.display = 'none';
            }
          }}
          className="absolute inset-0 h-full w-full object-cover"
          style={{ objectPosition: kind === 'image' ? '50% 52%' : '50% 32%' }}
        />
      ) : showInstagramFallback ? (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center text-[10px] font-semibold"
          style={{ background: 'linear-gradient(135deg, #f58529 0%, #dd2a7b 50%, #515bd4 100%)', color: '#fff' }}
        >
          <Play size={22} fill="currentColor" />
          <span className="mt-1">Instagram</span>
        </div>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center" style={{ color: 'var(--text-tertiary)' }}>
          <ImageIcon size={22} />
        </div>
      )}

      {kind === 'video' && src && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity group-hover:bg-black/45">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-black shadow-md">
            <Play size={18} fill="currentColor" />
          </div>
        </div>
      )}

      {(item.title || isInstagram(item) || isYouTube(item)) && (
        <div
          className="absolute inset-x-0 bottom-0 truncate px-2 py-1 text-[10px] font-medium"
          style={{
            background: 'linear-gradient(to top, rgba(0,0,0,0.78), rgba(0,0,0,0))',
            color: '#fff',
          }}
        >
          {isInstagram(item) ? 'Instagram · ' : isYouTube(item) ? 'YouTube · ' : ''}
          {item.title || ''}
        </div>
      )}
    </button>
  );
}

function Lightbox({ item, kind, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  if (!item) return null;

  const isVideo = kind === 'video';
  const youtube = isYouTube(item);
  const instagram = isInstagram(item);

  return createPortal(
    <div
      onClick={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label="Close"
      >
        <X size={20} />
      </button>

      {item.url && !isVideo && (
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute left-4 top-4 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white hover:bg-white/20"
        >
          <ExternalLink size={13} />
          Open original
        </a>
      )}

      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[88vh] max-w-[92vw] overflow-hidden rounded-2xl bg-black shadow-2xl"
        style={{ width: isVideo ? (instagram ? 'min(420px, 92vw)' : 'min(960px, 92vw)') : 'auto' }}
      >
        {isVideo ? (
          youtube && item.embed ? (
            <div style={{ aspectRatio: '16 / 9', width: '100%' }}>
              <iframe
                src={`${item.embed}?autoplay=1&rel=0`}
                title={item.title || 'Video'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="h-full w-full border-0"
              />
            </div>
          ) : instagram && item.embed ? (
            <div style={{ width: '100%', height: 'min(720px, 85vh)' }}>
              <iframe
                src={item.embed}
                title={item.title || 'Instagram'}
                allow="encrypted-media"
                allowFullScreen
                scrolling="no"
                className="h-full w-full border-0"
                style={{ background: '#fff' }}
              />
            </div>
          ) : item.embed ? (
            <div style={{ aspectRatio: '16 / 9', width: '100%' }}>
              <iframe src={item.embed} title={item.title || 'Video'} allowFullScreen className="h-full w-full border-0" />
            </div>
          ) : item.url && /\.(mp4|webm|ogg)(\?|$)/i.test(item.url) ? (
            <video src={item.url} controls autoPlay className="max-h-[88vh] max-w-[92vw]" />
          ) : (
            <div className="flex flex-col items-center gap-3 p-10 text-center text-white">
              <p>This video cannot be embedded.</p>
              {item.url && (
                <a href={item.url} target="_blank" rel="noopener noreferrer" className="underline">
                  Open the source page
                </a>
              )}
            </div>
          )
        ) : (
          <img
            src={item.url || item.thumbnail}
            alt={item.title || ''}
            referrerPolicy="no-referrer"
            onError={(e) => {
              const cur = e.currentTarget;
              if (!cur.dataset.proxied) {
                cur.dataset.proxied = '1';
                cur.src = viaProxy(item.url || item.thumbnail);
              }
            }}
            className="max-h-[88vh] max-w-[92vw] object-contain"
          />
        )}
      </div>

      {item.title && (
        <div className="absolute bottom-4 left-1/2 max-w-[80vw] -translate-x-1/2 truncate rounded-full bg-black/60 px-4 py-1.5 text-center text-xs text-white">
          {item.title}
        </div>
      )}
    </div>,
    document.body
  );
}

export default function RelatedMedia({ media }) {
  const [active, setActive] = useState(null); // { item, kind }
  const open = useCallback((item, kind) => setActive({ item, kind }), []);
  const close = useCallback(() => setActive(null), []);

  if (!media) return null;
  const videos = Array.isArray(media.videos) ? media.videos : [];
  const images = Array.isArray(media.images) ? media.images : [];
  if (!videos.length && !images.length) return null;

  return (
    <div className="not-prose mt-0 space-y-1.5 pt-0">
      {videos.length > 0 && (
        <div>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
            Related videos
          </div>
          <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'thin' }}>
            {videos.slice(0, 4).map((v, i) => (
              <MediaThumb key={`v-${v.videoId || v.url || i}`} item={v} kind="video" onOpen={open} />
            ))}
          </div>
        </div>
      )}
      {images.length > 0 && (
        <div>
          <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
            Related images
          </div>
          <div className="flex gap-2 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'thin' }}>
            {images.slice(0, 6).map((im, i) => (
              <MediaThumb key={`i-${im.url || i}`} item={im} kind="image" onOpen={open} />
            ))}
          </div>
        </div>
      )}

      {active && <Lightbox item={active.item} kind={active.kind} onClose={close} />}
    </div>
  );
}
