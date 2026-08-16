import { useEffect, useRef } from 'react';
import { getGlobeLayout } from '../../utils/globeLayout';

/**
 * ParticleGlobe — a reactive particle sphere centered on a glowing power
 * orb. The sphere idles with gentle rotation; when `thinking` is true the
 * particles ripple outward and the orb pulses harder. Lightweight enough
 * for a permanent welcome-screen role on modern devices.
 */
export default function ParticleGlobe({
  thinking = false,
  speaking = false,
  particleCount = 1200,
  iconAttractor = null,
  hasMessages = false,
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef({ thinking, speaking, iconAttractor, hasMessages });

  // Keep a live ref so the animation loop reads fresh prop values without
  // restarting on every change.
  useEffect(() => {
    stateRef.current = { thinking, speaking, iconAttractor, hasMessages };
  }, [thinking, speaking, iconAttractor, hasMessages]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    let width = 0;
    let height = 0;

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // ── Particle hull (golden-spiral sphere) in flat typed arrays so the
    // render loop stays allocation-free and can depth-sort every frame. ──
    const n = particleCount;
    const baseX = new Float32Array(n);
    const baseY = new Float32Array(n);
    const baseZ = new Float32Array(n);
    const phase = new Float32Array(n);
    const speed = new Float32Array(n);
    const hue = new Float32Array(n);
    const projX = new Float32Array(n);
    const projY = new Float32Array(n);
    const projZ = new Float32Array(n);
    const projR = new Float32Array(n); // squared distance from spin axis (rim factor)
    // Per-particle smoothed displacement (motion dampening) — target offsets
    // from the projected base position are eased into these arrays each frame
    // so the cursor / icon attraction flows instead of snapping.
    const dispX = new Float32Array(n);
    const dispY = new Float32Array(n);
    const order = new Array(n);

    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(n - 1, 1);
      const phi = Math.acos(1 - 2 * t);
      const theta = goldenAngle * i;
      const jitter = 0.95 + Math.random() * 0.1;
      baseX[i] = Math.sin(phi) * Math.cos(theta) * jitter;
      baseY[i] = Math.sin(phi) * Math.sin(theta) * jitter;
      baseZ[i] = Math.cos(phi) * jitter;
      phase[i] = Math.random() * Math.PI * 2;
      speed[i] = 0.6 + Math.random() * 0.7;
      hue[i] = 172 + Math.random() * 22;
      order[i] = i;
    }

    let rotation = 0;
    let pulse = 0;
    let energy = 0;
    let scatter = 0;  // Thinking burst scatter
    let edgeScatter = 0;  // NEW: sustained scatter to edges when messages appear
    let burstUntil = 0;
    let lastBurst = 0;
    let mouseX = 0;
    let mouseY = 0;
    let targetMouseX = 0;
    let targetMouseY = 0;
    let mouseInfluence = 0;
    let mouseInVicinity = false;
    let lastMouseMove = 0;
    let iconInfluence = 0;
    let raf = 0;

    const handlePointerMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      targetMouseX = event.clientX - rect.left;
      targetMouseY = event.clientY - rect.top;
      const inBounds = (
        targetMouseX >= -40
        && targetMouseY >= -40
        && targetMouseX <= rect.width + 40
        && targetMouseY <= rect.height + 40
      );
      mouseInVicinity = inBounds;
      lastMouseMove = performance.now();
    };

    const handlePointerLeave = () => {
      mouseInVicinity = false;
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: true });
    window.addEventListener('pointerleave', handlePointerLeave, { passive: true });

    const render = () => {
      const {
        thinking: isThinking,
        speaking: isSpeaking,
        iconAttractor: activeIconAttractor,
        hasMessages: hasChats,
      } = stateRef.current;
      const r1 = 94;
      const g1 = 234;
      const b1 = 212;
      const r2 = 34;
      const g2 = 211;
      const b2 = 238;
      const targetEnergy = isThinking ? 1 : isSpeaking ? 0.55 : 0;
      energy += (targetEnergy - energy) * 0.06;

      // Cognitive scatter bursts — the hull briefly dissipates while thinking.
      const now = performance.now();
      if (isThinking && now > burstUntil && now - lastBurst > 1400 + Math.random() * 1800) {
        burstUntil = now + 360 + Math.random() * 260;
        lastBurst = now;
      }
      const burstTarget = now < burstUntil ? 1 : 0;
      scatter += (burstTarget - scatter) * (burstTarget > scatter ? 0.18 : 0.05);

      // NEW: Smooth edge scatter when messages appear
      const edgeTarget = hasChats ? 1 : 0;
      edgeScatter += (edgeTarget - edgeScatter) * 0.08;  // Smooth animation

      // Only rotate when NOT thinking — stops spinning during cognitive activity
      if (!isThinking) {
        rotation += 0.0016 + energy * 0.004;
      }
      pulse += 0.04 + energy * 0.05;

      const layout = getGlobeLayout(width, height);
      const cx = layout.centerX;
      const cy = layout.centerY;
      const R = layout.globeRadius;
      const nowMs = performance.now();
      
      // In chat mode, disable MOUSE tracking but keep all autonomous behavior
      // (thinking bursts, rotation, oscillation, etc.)
      if (!hasChats) {
        const pointerActive = mouseInVicinity || nowMs - lastMouseMove < 260;
        const targetInfluence = pointerActive ? 1 : 0;
        // Slower lerp = motion dampening so the influence ramps up smoothly
        // instead of snapping when the pointer enters / leaves.
        mouseInfluence += (targetInfluence - mouseInfluence) * 0.07;
        if (mouseInfluence < 0.002) mouseInfluence = 0;
      } else {
        // In chat mode, fade out mouse tracking (cursor won't pull particles)
        // but all thinking/cognitive behavior remains autonomous
        mouseInfluence += (0 - mouseInfluence) * 0.07;
        if (mouseInfluence < 0.002) mouseInfluence = 0;
      }

      const hasIconAttractor = activeIconAttractor
        && Number.isFinite(activeIconAttractor.x)
        && Number.isFinite(activeIconAttractor.y);
      const targetIconInfluence = hasIconAttractor ? 1 : 0;
      iconInfluence += (targetIconInfluence - iconInfluence) * 0.16;
      if (iconInfluence < 0.002) iconInfluence = 0;
      const attractorX = hasIconAttractor ? activeIconAttractor.x : cx;
      const attractorY = hasIconAttractor ? activeIconAttractor.y : cy;
      if (mouseX === 0 && mouseY === 0) {
        mouseX = cx;
        mouseY = cy;
        targetMouseX = cx;
        targetMouseY = cy;
      }
      mouseX += (targetMouseX - mouseX) * 0.09;
      mouseY += (targetMouseY - mouseY) * 0.09;

      ctx.clearRect(0, 0, width, height);

      // ── Halo glow ──
      const haloRadius = R * (1.7 + Math.sin(pulse * 0.6) * 0.05 + energy * 0.2);
      const halo = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, haloRadius);
      halo.addColorStop(0, `rgba(${r1}, ${g1}, ${b1}, ${0.22 + energy * 0.16})`);
      halo.addColorStop(0.5, `rgba(${r2}, ${g2}, ${b2}, ${0.08 + energy * 0.06})`);
      halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
      ctx.fill();

      // ── Project + rotate every particle ──
      const cosR = Math.cos(rotation);
      const sinR = Math.sin(rotation);
      const tilt = 0.34;
      const cosT = Math.cos(tilt);
      const sinT = Math.sin(tilt);
      const ripple = energy * 0.4;

      for (let i = 0; i < n; i++) {
        let x = baseX[i] * cosR - baseZ[i] * sinR;
        let z = baseX[i] * sinR + baseZ[i] * cosR;
        let y = baseY[i];
        const ny = y * cosT - z * sinT;
        const nz = y * sinT + z * cosT;
        y = ny;
        z = nz;

        const burst = scatter * (0.5 + (i % 19) / 26);
        const wobble =
          1 +
          Math.sin(pulse * speed[i] + phase[i]) * (0.012 + ripple * 0.04) +
          ripple * 0.05 +
          burst;
        
        // Reduce spread by 10% when thinking to keep particles more compact
        const spreadFactor = isThinking ? 0.9 : 1.0;
        const adjustedWobble = wobble * spreadFactor;

        let px = cx + x * R * adjustedWobble;
        let py = cy + y * R * adjustedWobble;

        // NEW: Apply edge scatter — push particles outward toward screen edges
        // The stronger they scatter, the more they move toward the edge
        if (edgeScatter > 0.002) {
          const distFromCenter = Math.hypot(x, y) || 1;
          // Direction away from center
          const outwardX = (x / distFromCenter) * edgeScatter * (320 + R * 1.2);
          const outwardY = (y / distFromCenter) * edgeScatter * (320 + R * 1.2);
          px += outwardX;
          py += outwardY;
        }

        // ── Build TARGET displacement for this frame, then smooth into the
        // persistent dispX/dispY (motion dampening) so flow feels fluid.
        let targetDX = 0;
        let targetDY = 0;

        if (mouseInfluence > 0) {
          const dx = mouseX - px;
          const dy = mouseY - py;
          const dist = Math.hypot(dx, dy) || 1;
          // Broader catchment so more distant particles are recruited into
          // the cluster, but a much tighter focal point so they tuck in
          // close around the cursor instead of orbiting it from far out.
          const vicinity = Math.max(160, R * 1.55) * 1.2;
          if (dist < vicinity) {
            // Tight focal "comfort disc" — particles inside this small zone
            // get a soft tangential swirl only, so the cluster reads as a
            // crisp focal point, not a diffuse blob.
            const comfort = Math.max(14, R * 0.11);
            const norm = 1 - dist / vicinity;
            // Stronger pull (≈1.7× previous) so the recruitment from the
            // wider catchment feels decisive.
            const pull = Math.pow(norm, 1.4) * (48 + R * 0.46) * mouseInfluence;
            const depthFactor = 0.55 + ((z + 1) / 2) * 0.6;
            if (dist > comfort) {
              // Map distance so the "target" is the comfort-disc edge, not
              // the cursor itself. Pull is also gated so particles never
              // overshoot inside the disc.
              const travel = dist - comfort;
              const step = Math.min(pull * depthFactor, travel * 0.85);
              targetDX += (dx / dist) * step;
              targetDY += (dy / dist) * step;
            } else {
              // Inside the comfort disc: gentle TANGENTIAL drift only. This
              // keeps the cluster lively and spread out instead of stacked.
              const tangentX = -dy / dist;
              const tangentY = dx / dist;
              const swirlDir = (i % 2 === 0 ? 1 : -1);
              const swirl = (0.35 + (1 - dist / comfort) * 0.4) * (4 + R * 0.05) * mouseInfluence;
              targetDX += tangentX * swirl * swirlDir;
              targetDY += tangentY * swirl * swirlDir;
            }
          }
        }

        // Hovering a tool icon: particles should ARC AROUND the icon, not
        // pile onto it. We combine an outer attraction ring (draw them in),
        // a tangential swirl (orbit), and a hard repulsion bubble inside the
        // icon radius so dots clearly wrap around the glyph.
        if (iconInfluence > 0) {
          const dx = attractorX - px;
          const dy = attractorY - py;
          const dist = Math.hypot(dx, dy) || 1;
          const iconVicinity = Math.max(280, R * 2.6);
          if (dist < iconVicinity) {
            const norm = 1 - dist / iconVicinity;
            const depthFactor = 0.68 + ((z + 1) / 2) * 0.62;
            const tangentX = -dy / dist;
            const tangentY = dx / dist;
            const swirlDir = (i % 2 === 0 ? 1 : -1);
            const orbit = (0.5 + norm) * (8 + R * 0.1) * iconInfluence;
            targetDX += tangentX * orbit * swirlDir;
            targetDY += tangentY * orbit * swirlDir;

            // Clear zone around the icon — push particles outward so they
            // visibly wrap around it instead of covering the glyph.
            const iconClearRadius = 46;
            if (dist < iconClearRadius) {
              const clearNorm = 1 - dist / iconClearRadius;
              const push = clearNorm * clearNorm * (24 + R * 0.22) * iconInfluence;
              targetDX -= (dx / dist) * push;
              targetDY -= (dy / dist) * push;
            } else {
              // Mild inward pull from the outer ring into the swirl region.
              const pull = Math.pow(norm, 1.8) * (10 + R * 0.08) * iconInfluence;
              targetDX += (dx / dist) * pull * depthFactor;
              targetDY += (dy / dist) * pull * depthFactor;
            }
          }
        }

        // ── Black hole gravity ──
        // When thinking, the center becomes an active gravitational anchor
        if (isThinking) {
          const dx = -px; // Vector from particle toward center
          const dy = -py;
          const dist = Math.hypot(dx, dy) || 1;
          const blackholeVicinity = R * 1.8; // Pull zone extends fairly wide
          
          if (dist < blackholeVicinity) {
            const norm = 1 - Math.min(1, dist / blackholeVicinity);
            const depthFactor = 0.6 + ((z + 1) / 2) * 0.5;
            
            // Strong inward pull — particles spiral toward the black hole
            const gravity = Math.pow(norm, 1.3) * (28 + R * 0.35) * scatter;
            targetDX += (dx / dist) * gravity * depthFactor;
            targetDY += (dy / dist) * gravity * depthFactor;
            
            // Vortex/swirl around the black hole — makes it feel alive and autonomous
            const tangentX = -dy / dist;
            const tangentY = dx / dist;
            const swirlDir = (i % 2 === 0 ? 1 : -1);
            const vortex = norm * (6 + R * 0.08) * scatter;
            targetDX += tangentX * vortex * swirlDir;
            targetDY += tangentY * vortex * swirlDir;
          }
        }

        // Motion dampening: lerp this particle's smoothed displacement toward
        // the new target. Lower factor = more inertia / smoother flow.
        dispX[i] += (targetDX - dispX[i]) * 0.18;
        dispY[i] += (targetDY - dispY[i]) * 0.18;
        px += dispX[i];
        py += dispY[i];

        projX[i] = px;
        projY[i] = py;
        projZ[i] = z;
        projR[i] = x * x + y * y;
        order[i] = i;
      }

      // Depth-sort back-to-front so the sphere reads as a solid volume.
      order.sort((a, b) => projZ[a] - projZ[b]);

      // ── Particle shell (normal blending — crisp dots, no bloom) ──
      ctx.globalCompositeOperation = 'source-over';
      const shimmer = pulse * 0.5;
      for (let k = 0; k < n; k++) {
        const i = order[k];
        const depth = (projZ[i] + 1) / 2;                 // 0 far .. 1 near
        const rim = Math.min(1, Math.max(0, (projR[i] - 0.55) / 0.45));
        const band = 0.5 + 0.5 * Math.sin(shimmer + baseY[i] * 3 + phase[i] * 0.4);

        const baseAlpha = Math.min(
          1,
          (0.1 + depth * 0.5 + rim * 0.3) * (0.72 + 0.28 * band) + energy * 0.16,
        );
        // When scattered to edges, particles fade out to stay minimal
        const scatterFade = 1 - edgeScatter * 0.35;
        const alpha = baseAlpha * scatterFade;
        // Dot size is driven by the rim (silhouette) factor: particles facing
        // us at the middle stay small, growing toward the largest size at the
        // outer edges of the sphere. A higher base keeps the centre dots from
        // reading as near-invisible specks next to the large rim particles.
        const dot = (0.9 + rim * rim * 1.5 + ripple * 0.4) * (0.82 + 0.3 * band);
        const light = 52 + depth * 26 + rim * 8;
        const sat = 80 - depth * 20;
        const particleHue = hue[i];
        ctx.fillStyle = `hsla(${particleHue}, ${sat}%, ${light}%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(projX[i], projY[i], dot, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';

      // ── Misty inner core ──
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.72, 0, Math.PI * 2);
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      for (let s = 0; s < 4; s++) {
        const ang = rotation * 1.4 + s * (Math.PI / 2);
        const mx = cx + Math.cos(ang) * R * 0.2;
        const my = cy + Math.sin(ang * 1.2) * R * 0.16;
        const r = R * (0.3 + (s % 2) * 0.08);
        const grad = ctx.createRadialGradient(mx, my, 0, mx, my, r);
        const cr = 103;
        const cg = 232;
        const cb = 249;
        grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${0.14 + energy * 0.12})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ── Black Hole nucleus — bright, static, and active ──
      // No pulsation: static, bright core that acts as a gravitational anchor
      const orbR = R * 0.08;
      
      // Dim the orb by 50% when chat is active to avoid interfering with messages
      const orbDimFactor = hasChats ? 0.5 : 1.0;
      
      // SUPER bright corona — the black hole's event horizon glow
      const corona = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR * 6);
      corona.addColorStop(0, `rgba(255, 255, 255, ${(0.7 + energy * 0.2) * orbDimFactor})`);
      corona.addColorStop(0.15, `rgba(200, 255, 255, ${(0.55 + energy * 0.15) * orbDimFactor})`);
      corona.addColorStop(0.45, `rgba(${r1}, ${g1}, ${b1}, ${(0.28 + energy * 0.12) * orbDimFactor})`);
      corona.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = corona;
      ctx.beginPath();
      ctx.arc(cx, cy, orbR * 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      // Bright, luminous core — pure white hot singularity
      const orbGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR);
      orbGrad.addColorStop(0, `rgba(255, 255, 255, ${orbDimFactor})`);
      orbGrad.addColorStop(0.3, `rgba(255, 255, 255, ${orbDimFactor})`);
      orbGrad.addColorStop(0.7, `rgba(128, 255, 255, ${orbDimFactor})`);
      orbGrad.addColorStop(1, `rgba(${r1}, ${g1}, ${b1}, ${orbDimFactor})`);
      ctx.fillStyle = orbGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
      ctx.fill();

      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [particleCount]);

  return <canvas ref={canvasRef} className="particle-globe-canvas" aria-hidden="true" />;
}
