export default function MiraLogo({ size = 32, className = '', wordmark = false }) {
  return (
    <span className={`inline-flex items-center gap-3 ${className}`} aria-label="MIRA">
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="42" height="42" rx="13" fill="rgba(94,234,212,0.06)" stroke="currentColor" strokeWidth="1.5" />
        <path d="M13 32V16L24 27L35 16V32" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="24" cy="24" r="2.2" fill="currentColor" />
      </svg>
      {wordmark && (
        <span className="flex flex-col leading-none">
          <span className="font-semibold tracking-[0.34em]" style={{ fontSize: Math.max(12, size * 0.42) }}>MIRA</span>
          <span className="uppercase tracking-[0.28em] opacity-60 mt-1" style={{ fontSize: Math.max(7, size * 0.19) }}>AI Assistant</span>
        </span>
      )}
    </span>
  );
}
