export function getGlobeLayout(viewportWidth = 1280, viewportHeight = 800) {
  const w = Math.max(1, Number(viewportWidth) || 1280);
  const h = Math.max(1, Number(viewportHeight) || 800);
  const vmin = Math.min(w, h);
  const isMobile = w <= 640;

  const globeRadius = Math.max(110, Math.min(vmin * 0.18, 260));
  const safeTop = isMobile ? 132 : 92;
  const safeBottom = isMobile ? 210 : 120;
  const preferredCenterY = h * (isMobile ? 0.47 : 0.5);
  const minCenterY = safeTop + globeRadius;
  const maxCenterY = Math.max(minCenterY, h - safeBottom - globeRadius);

  const centerX = w / 2;
  const centerY = Math.max(minCenterY, Math.min(maxCenterY, preferredCenterY));

  const topRoom = centerY - safeTop;
  const bottomRoom = h - safeBottom - centerY;
  const verticalCap = Math.max(90, Math.min(topRoom, bottomRoom) - (isMobile ? 20 : 28));
  const orbitRadius = Math.max(globeRadius + (isMobile ? 26 : 50), Math.min(globeRadius * 1.45, verticalCap));

  return {
    isMobile,
    centerX,
    centerY,
    globeRadius,
    orbitRadius,
    ringDiameter: orbitRadius * 2,
    iconSize: isMobile ? 18 : 22,
  };
}
