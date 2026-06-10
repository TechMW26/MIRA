import { useEffect, useRef } from 'react';

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
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef({ thinking, speaking });

  // Keep a live ref so the animation loop reads fresh prop values without
  // restarting on every change.
  useEffect(() => {
    stateRef.current = { thinking, speaking };
  }, [thinking, speaking]);
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
    let scatter = 0;
    let burstUntil = 0;
    let lastBurst = 0;
    let raf = 0;

    // Globe radius tracks the CSS clamp on .particle-globe-wrap so the sphere
    // keeps a steady size even though the canvas now spans the whole stage.
    const globeRadius = () => {
      const vmin = Math.min(window.innerWidth, window.innerHeight);
      const wrap = Math.max(240, Math.min(vmin * 0.44, 400));
      return wrap * 0.36;
    };

    const render = () => {
      const { thinking: isThinking, speaking: isSpeaking } = stateRef.current;
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

      rotation += 0.0016 + energy * 0.004;
      pulse += 0.04 + energy * 0.05;

      const cx = width / 2;
      const cy = height / 2;
      const R = globeRadius();

      ctx.clearRect(0, 0, width, height);

      // ── Halo glow ──
      const haloRadius = R * (1.7 + Math.sin(pulse * 0.6) * 0.05 + energy * 0.2);
      const halo = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, haloRadius);
      halo.addColorStop(0, `rgba(94, 234, 212, ${0.22 + energy * 0.16})`);
      halo.addColorStop(0.5, `rgba(34, 211, 238, ${0.08 + energy * 0.06})`);
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

        projX[i] = cx + x * R * wobble;
        projY[i] = cy + y * R * wobble;
        projZ[i] = z;
        projR[i] = x * x + y * y;
        order[i] = i;
      }

      // Depth-sort back-to-front so the sphere reads as a solid volume.
      order.sort((a, b) => projZ[a] - projZ[b]);

      // ── Particle shell (additive so overlaps bloom into light) ──
      ctx.globalCompositeOperation = 'lighter';
      const shimmer = pulse * 0.5;
      for (let k = 0; k < n; k++) {
        const i = order[k];
        const depth = (projZ[i] + 1) / 2;                 // 0 far .. 1 near
        const rim = Math.min(1, Math.max(0, (projR[i] - 0.55) / 0.45));
        const band = 0.5 + 0.5 * Math.sin(shimmer + baseY[i] * 3 + phase[i] * 0.4);

        const alpha = Math.min(
          1,
          (0.1 + depth * 0.5 + rim * 0.3) * (0.72 + 0.28 * band) + energy * 0.16,
        );
        // Dot size is driven by the rim (silhouette) factor: particles facing
        // us at the middle stay small, growing toward the largest size at the
        // outer edges of the sphere. A higher base keeps the centre dots from
        // reading as near-invisible specks next to the large rim particles.
        const dot = (0.9 + rim * rim * 2.4 + ripple * 0.4) * (0.82 + 0.3 * band);
        const light = 52 + depth * 26 + rim * 8;
        const sat = 80 - depth * 20;                      // near side reads whiter

        ctx.fillStyle = `hsla(${hue[i]}, ${sat}%, ${light}%, ${alpha})`;
        ctx.beginPath();
        ctx.arc(projX[i], projY[i], dot, 0, Math.PI * 2);
        ctx.fill();

        // Bright rim sparks on the near silhouette for an energy-shell glint.
        if (depth > 0.78 && rim > 0.6 && (i % 6) === 0) {
          ctx.fillStyle = `hsla(${hue[i]}, 90%, 82%, ${alpha * 0.22})`;
          ctx.beginPath();
          ctx.arc(projX[i], projY[i], dot * 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
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
        grad.addColorStop(0, `rgba(103, 232, 249, ${0.14 + energy * 0.12})`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // ── Power orb (bright nucleus) ──
      const orbR = R * (0.08 + Math.sin(pulse * 0.9) * 0.01 + energy * 0.035);
      const corona = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR * 5);
      corona.addColorStop(0, `rgba(255, 255, 255, ${0.5 + energy * 0.25})`);
      corona.addColorStop(0.3, `rgba(186, 252, 251, ${0.34 + energy * 0.16})`);
      corona.addColorStop(0.65, `rgba(94, 234, 212, ${0.14 + energy * 0.08})`);
      corona.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = corona;
      ctx.beginPath();
      ctx.arc(cx, cy, orbR * 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';

      const orbGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR);
      orbGrad.addColorStop(0, '#ffffff');
      orbGrad.addColorStop(0.55, '#bafcfb');
      orbGrad.addColorStop(1, '#5eead4');
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
    };
  }, [particleCount]);

  return <canvas ref={canvasRef} className="particle-globe-canvas" aria-hidden="true" />;
}
