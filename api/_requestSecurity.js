const buckets = new Map();
const OFFICIAL_ORIGINS = new Set([
  'https://www.itsmira.cloud',
  'https://itsmira.cloud',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function json(payload, status, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}

function allowedOrigins() {
  const configured = String(process.env.MIRA_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return new Set([...OFFICIAL_ORIGINS, ...configured]);
}

function requestIp(request) {
  return String(
    request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]
    || 'local',
  ).trim().slice(0, 100);
}

export function guardRequest(request, { limit = 60, windowMs = 60_000, key = '' } = {}) {
  const origin = String(request.headers.get('origin') || '').trim();
  const fetchSite = String(request.headers.get('sec-fetch-site') || '').toLowerCase();
  if (fetchSite === 'cross-site' || (origin && !allowedOrigins().has(origin))) {
    return json({ error: 'Cross-origin API access is not allowed.' }, 403);
  }

  const now = Date.now();
  const pathname = new URL(request.url).pathname;
  const bucketKey = `${key || pathname}:${requestIp(request)}`;
  const current = buckets.get(bucketKey);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : current;
  bucket.count += 1;
  buckets.set(bucketKey, bucket);
  if (buckets.size > 5_000) {
    for (const [entryKey, entry] of buckets) {
      if (entry.resetAt <= now) buckets.delete(entryKey);
    }
  }
  if (bucket.count > limit) {
    return json({ error: 'Too many requests. Please retry shortly.' }, 429, {
      'Retry-After': String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))),
    });
  }
  return null;
}
