import { useEffect, useMemo, useRef, useState } from 'react';
import { expressionsForMiraActivity } from '../../services/miraIdentity';
import { getGlobeLayout } from '../../utils/globeLayout';

// Expression proportions are adapted for React from the MIT-licensed Bloub
// project by Jérémy Perret. The bundled licence lives at /licenses/bloub.txt.
const EXPRESSIONS = {
  neutral: { split: 18, roll: 0, eyes: [[22, 35, 0], [22, 35, 0]] },
  attentive: { split: 16, roll: -4, eyes: [[21, 44, 0], [21, 44, 0]] },
  surprised: { split: 19, roll: 0, eyes: [[45, 47, 0], [45, 47, 0]] },
  excited: { split: 20, roll: 0, eyes: [[40, 56, -10], [40, 56, 10]] },
  happy: { split: 17, roll: 0, eyes: [[27, 17, 14], [27, 17, -14]] },
  laughing: { split: 18, roll: 0, eyes: [[34, 13, 20], [34, 13, -20]] },
  angry: { split: 17, roll: 0, eyes: [[34, 15, 30], [34, 15, -30]] },
  sad: { split: 16, roll: 0, eyes: [[22, 40, -28], [22, 40, 28]] },
  scared: { split: 21, roll: 0, eyes: [[40, 60, 0], [40, 60, 0]] },
  suspicious: { split: 16, roll: -6, eyes: [[21, 40, 0], [22, 15, 0]] },
  confused: { split: 17, roll: 8, eyes: [[20, 44, -18], [28, 17, 14]] },
  curious: { split: 17, roll: -15, eyes: [[24, 46, -8], [20, 38, -8]] },
  proud: { split: 17, roll: 0, eyes: [[30, 15, 18], [30, 15, -18]] },
  shy: { split: 14, roll: -7, eyes: [[17, 30, 0], [17, 30, 0]] },
  unimpressed: { split: 16, roll: 0, eyes: [[30, 12, 0], [30, 12, 0]] },
  sleepy: { split: 16, roll: -3, eyes: [[20, 18, 0], [20, 18, 0]] },
};

const HOVER_REACTIONS = [
  'attentive',
  'curious',
  'surprised',
  'happy',
  'shy',
  'excited',
  'suspicious',
  'laughing',
];

function Eye({ config, side }) {
  const [width, height, tilt] = config;
  return (
    <span
      className={`mira-bloub__eye mira-bloub__eye--${side}`}
      style={{
        '--eye-width': `${Math.max(7, Math.min(20, width * 0.42))}%`,
        '--eye-height': `${Math.max(7, Math.min(25, height * 0.42))}%`,
        '--eye-tilt': `${tilt}deg`,
      }}
    />
  );
}

export default function MiraBloub({
  expression = 'neutral',
  activity = 'idle',
  expanded = false,
  variant = 'ambient',
}) {
  const layerRef = useRef(null);
  const hoverCycleRef = useRef(null);
  const hoverResetRef = useRef(null);
  const hoverIndexRef = useRef(-1);
  const activityIndexRef = useRef(0);
  const [viewport, setViewport] = useState({ width: 1280, height: 800 });
  const [hovered, setHovered] = useState(false);
  const [hoverExpression, setHoverExpression] = useState(null);
  const [activityExpression, setActivityExpression] = useState(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return undefined;
    const update = () => setViewport({ width: layer.clientWidth, height: layer.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(layer);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => getGlobeLayout(viewport.width, viewport.height),
    [viewport.height, viewport.width],
  );
  const activityExpressions = useMemo(
    () => expressionsForMiraActivity(activity, expression),
    [activity, expression],
  );
  const activeExpression = hoverExpression || activityExpression || expression;
  const face = EXPRESSIONS[activeExpression] || EXPRESSIONS.neutral;
  const voiceMode = variant === 'voice';
  const desktopMode = variant === 'desktop';
  const companionMode = variant === 'companion';
  const size = voiceMode
    ? Math.max(170, Math.min(280, Math.min(viewport.width, viewport.height) * 0.78))
    : companionMode
    ? Math.max(82, Math.min(118, Math.min(viewport.width, viewport.height) * 0.72))
    : desktopMode
    ? Math.max(48, Math.min(66, viewport.width * 0.12))
    : expanded
    ? Math.max(62, Math.min(82, viewport.width * 0.065))
    : layout.globeRadius * 2;
  const centerX = voiceMode || desktopMode || companionMode ? viewport.width / 2 : layout.centerX;
  const centerY = voiceMode
    ? viewport.height / 2
    : companionMode
    ? viewport.height / 2
    : desktopMode
    ? Math.max(44, Math.min(58, viewport.height * 0.075))
    : expanded
    ? Math.max(50, Math.min(64, viewport.height * 0.072))
    : layout.centerY;

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return undefined;

    const setGaze = (x, y) => {
      layer.style.setProperty('--mira-gaze-x', `${x.toFixed(2)}px`);
      layer.style.setProperty('--mira-gaze-y', `${y.toFixed(2)}px`);
    };
    const handlePointerMove = (event) => {
      const rect = layer.getBoundingClientRect();
      const dx = event.clientX - rect.left - centerX;
      const dy = event.clientY - rect.top - centerY;
      const distance = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, distance / Math.max(size * 1.5, 1));
      const maxTravel = Math.max(3, Math.min(12, size * 0.045));
      setGaze((dx / distance) * reach * maxTravel, (dy / distance) * reach * maxTravel);
    };
    const resetGaze = () => setGaze(0, 0);

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', resetGaze, { passive: true });
    window.addEventListener('blur', resetGaze);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', resetGaze);
      window.removeEventListener('blur', resetGaze);
    };
  }, [centerX, centerY, size]);

  useEffect(() => () => {
    window.clearInterval(hoverCycleRef.current);
    window.clearTimeout(hoverResetRef.current);
  }, []);

  useEffect(() => {
    activityIndexRef.current = 0;
    setActivityExpression(activityExpressions[0] || expression);
    if (activityExpressions.length < 2) return undefined;

    const intervalMs = activity === 'speaking' || activity === 'responding' ? 1250 : 1650;
    const interval = window.setInterval(() => {
      activityIndexRef.current = (activityIndexRef.current + 1) % activityExpressions.length;
      setActivityExpression(activityExpressions[activityIndexRef.current]);
    }, intervalMs);
    return () => window.clearInterval(interval);
  }, [activity, activityExpressions, expression]);

  const advanceHoverExpression = () => {
    let nextIndex = hoverIndexRef.current;
    for (let attempt = 0; attempt < HOVER_REACTIONS.length; attempt += 1) {
      nextIndex = (nextIndex + 1) % HOVER_REACTIONS.length;
      if (HOVER_REACTIONS[nextIndex] !== expression) break;
    }
    hoverIndexRef.current = nextIndex;
    setHoverExpression(HOVER_REACTIONS[nextIndex]);
  };

  const handlePointerEnter = () => {
    window.clearTimeout(hoverResetRef.current);
    window.clearInterval(hoverCycleRef.current);
    setHovered(true);
    advanceHoverExpression();
    hoverCycleRef.current = window.setInterval(advanceHoverExpression, 900);
  };

  const handlePointerLeave = () => {
    setHovered(false);
    window.clearInterval(hoverCycleRef.current);
    hoverCycleRef.current = null;
    window.clearTimeout(hoverResetRef.current);
    hoverResetRef.current = window.setTimeout(() => {
      setHoverExpression(null);
      hoverResetRef.current = null;
    }, 260);
  };

  return (
    <div ref={layerRef} className={`mira-identity-layer ${voiceMode ? 'is-voice' : companionMode ? 'is-companion' : desktopMode ? 'is-desktop' : expanded ? 'is-expanded' : 'is-home'}`}>
      <div
        className="mira-bloub"
        data-expression={activeExpression}
        data-activity={activity}
        data-hover-state={hovered ? 'active' : hoverExpression ? 'settling' : 'idle'}
        style={{
          '--bloub-size': `${size}px`,
          '--bloub-x': `${centerX}px`,
          '--bloub-y': `${centerY}px`,
          '--bloub-roll': `${face.roll}deg`,
          '--eye-split': `${face.split}%`,
        }}
        role="img"
        aria-label={`Mira is ${activity === 'idle' ? activeExpression : activity}`}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <div className="mira-bloub__body">
          <span className="mira-bloub__shine" />
          <span className="mira-bloub__face">
            <Eye config={face.eyes[0]} side="left" />
            <Eye config={face.eyes[1]} side="right" />
          </span>
        </div>
      </div>
    </div>
  );
}
