export default function MiraLogo({ size = 32, className = '', wordmark = false }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`} aria-label="MIRA">
      <img
        src="/icons/icon-512.png"
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        className="block flex-shrink-0 object-contain"
        style={{ width: size, height: size }}
      />
      {wordmark && (
        <span className="flex flex-col leading-none">
          <span className="font-semibold tracking-[0.34em]" style={{ fontSize: Math.max(12, size * 0.42) }}>MIRA</span>
          <span className="uppercase tracking-[0.28em] opacity-60 mt-1" style={{ fontSize: Math.max(7, size * 0.19) }}>AI Assistant</span>
        </span>
      )}
    </span>
  );
}
