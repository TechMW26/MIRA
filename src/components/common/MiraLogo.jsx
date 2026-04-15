export default function MiraLogo({ size = 32, className = '' }) {
  return (
    <img
      src="/mira-logo.png"
      alt="MIRA"
      width={size}
      height={size}
      className={`rounded-lg object-cover ${className}`}
    />
  );
}
