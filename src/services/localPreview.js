const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);
const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;

export function normalizeLocalPreviewUrl(value = '') {
  let candidate = String(value || '').trim().replace(/[),.;]+$/, '');
  if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(candidate)) {
    candidate = `http://${candidate}`;
  }
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || !LOCAL_HOSTS.has(url.hostname)) return '';
    if (url.hostname === '0.0.0.0') url.hostname = 'localhost';
    return url.href;
  } catch {
    return '';
  }
}

export function extractTerminalLinks(value = '') {
  return [...String(value || '').matchAll(URL_PATTERN)]
    .map((match) => match[0].replace(/[),.;]+$/, ''))
    .filter((url, index, all) => all.indexOf(url) === index);
}
