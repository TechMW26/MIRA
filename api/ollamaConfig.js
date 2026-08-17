export function parseOllamaKeepAlive(value, fallback = 0) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return fallback;
  if (/^-?\d+$/.test(normalized)) return Number(normalized);
  return normalized;
}
