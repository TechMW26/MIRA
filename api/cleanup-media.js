import { list, del } from '@vercel/blob';

const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function extractTimestamp(pathname = '') {
  const match = String(pathname).match(/generated\/[^/]+\/[^/]+\/(\d+)-/);
  if (!match) return null;
  const ts = Number(match[1]);
  return Number.isFinite(ts) ? ts : null;
}

export async function GET(request) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const authorization = String(request?.headers?.get?.('authorization') || '');
  if (cronSecret && authorization !== `Bearer ${cronSecret}`) {
    return json({ ok: false, error: 'Unauthorized.' }, 401);
  }
  try {
    const cutoff = Date.now() - RETENTION_MS;
    let cursor;
    let deleted = 0;
    let scanned = 0;

    do {
      const page = await list({ cursor, limit: 1000, prefix: 'generated/' });
      cursor = page.cursor;

      const expiredPathnames = [];
      for (const blob of page.blobs || []) {
        scanned += 1;
        const ts = extractTimestamp(blob.pathname);
        if (!ts) continue;
        if (ts < cutoff) expiredPathnames.push(blob.pathname);
      }

      if (expiredPathnames.length) {
        await Promise.allSettled(expiredPathnames.map((pathname) => del(pathname)));
        deleted += expiredPathnames.length;
      }
    } while (cursor);

    return json({ ok: true, scanned, deleted });
  } catch (error) {
    return json({ ok: false, error: error?.message || 'Cleanup failed' }, 500);
  }
}
