import { memo, useMemo } from 'react';

const MAX_ANIMATED_CHARS = 1000;

function seededUnit(index, salt) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function particleStyle(index) {
  const progress = (index % 160) / 159;
  const horizontalWave = Math.sin(progress * Math.PI * 2.8) * 18;
  const x = Math.round((seededUnit(index, 1) - 0.5) * 42 + horizontalWave * (1 - progress * 0.35));
  const y = Math.round((seededUnit(index, 2) - 0.5) * 34 - (1 - progress) * 18);
  const rotate = Math.round((seededUnit(index, 3) - 0.5) * 50);
  const scale = (0.72 + seededUnit(index, 4) * 0.9).toFixed(2);
  const delay = Math.min((index % 80) * 0.0045 + seededUnit(index, 5) * 0.08, 0.42).toFixed(3);

  return {
    '--particle-x': `${x}px`,
    '--particle-y': `${y}px`,
    '--particle-rotate': `${rotate}deg`,
    '--particle-scale': scale,
    '--particle-delay': `${delay}s`,
  };
}

function ParticleText({ text, active = false, placeholder = false }) {
  const sourceText = text || '';
  const { prefix, animatedUnits } = useMemo(() => {
    if (!sourceText) return { prefix: '', animatedUnits: [] };
    const splitAt = Math.max(0, sourceText.length - MAX_ANIMATED_CHARS);
    return {
      prefix: sourceText.slice(0, splitAt),
      animatedUnits: Array.from(sourceText.slice(splitAt)),
    };
  }, [sourceText]);

  return (
    <div
      className={`particle-text ${active ? 'particle-text-active' : ''} ${placeholder ? 'particle-text-placeholder' : ''}`}
      aria-label={sourceText}
    >
      {prefix && <span className="particle-text-static">{prefix}</span>}
      <span aria-hidden="true">
        {animatedUnits.map((char, index) => {
          const absoluteIndex = prefix.length + index;
          if (char === ' ') return <span key={`space-${absoluteIndex}`}> </span>;
          if (char === '\n') return <br key={`line-${absoluteIndex}`} />;
          return (
            <span
              key={`${absoluteIndex}-${char}`}
              className="particle-glyph"
              style={particleStyle(absoluteIndex)}
            >
              {char}
            </span>
          );
        })}
      </span>
    </div>
  );
}

export default memo(ParticleText);