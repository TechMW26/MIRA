import { lookup } from 'node:dns/promises';

const HTTP_PROTOCOLS = new Set(['http:', 'https:']);

export function isPrivateHostname(hostname) {
  if (!hostname) return true;
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0' || h === '0.0.0.0') return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  if (h.startsWith('::ffff:')) return isPrivateHostname(h.slice(7));
  const match = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match) {
    const octets = match.slice(1).map(Number);
    if (octets.some((value) => value > 255)) return true;
    const [a, b] = octets;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
  }
  return false;
}

export function validatePublicHttpUrl(value = '') {
  let parsed;
  try { parsed = new URL(String(value || '').trim()); } catch { return null; }
  if (!HTTP_PROTOCOLS.has(parsed.protocol) || isPrivateHostname(parsed.hostname)) return null;
  parsed.username = '';
  parsed.password = '';
  parsed.hash = '';
  return parsed;
}

async function resolvesPublicly(target) {
  try {
    const addresses = await lookup(target.hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every(({ address }) => !isPrivateHostname(address));
  } catch {
    return false;
  }
}

export async function fetchPublicUrl(initialTarget, {
  signal,
  headers = {},
  maxRedirects = 3,
} = {}) {
  let target = initialTarget instanceof URL ? initialTarget : validatePublicHttpUrl(initialTarget);
  if (!target) throw new Error('The URL is not allowed.');
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    if (!await resolvesPublicly(target)) throw new Error('Private-network targets are not allowed.');
    const response = await fetch(target.toString(), {
      method: 'GET',
      signal,
      redirect: 'manual',
      headers,
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    const redirected = location ? validatePublicHttpUrl(new URL(location, target).toString()) : null;
    if (!redirected) throw new Error('The redirect target is not allowed.');
    target = redirected;
  }
  throw new Error('The URL redirected too many times.');
}
