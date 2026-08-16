import { put, del } from '@vercel/blob';

const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_PROMPT_CHARS = 4000;
const NSFW_PROMPT_PATTERN = /\b(nude|nudity|naked|explicit|erotic|porn|pornographic|xxx|18\+|lewd|nsfw|genitals?|penis|vagina|sex|sexual|breasts?|nipples?)\b/i;
const INVALID_PROMPT_PATTERN = /(?:^|\[)(?:using tools?|mira_tool)|^(?:\.{2,}|…+|image|picture|photo|generated image)$/i;

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cleanPrompt(value = '') {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= MAX_PROMPT_CHARS) return compact;
  return compact.slice(0, MAX_PROMPT_CHARS).replace(/\s+\S*$/, '').trim();
}

function safeId(value = '') {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

function promptSeed(value = '') {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 999999) + 1;
}

function buildImagePath({ userId, conversationId, messageId }) {
  const ts = Date.now();
  const uid = safeId(userId) || 'anon';
  const cid = safeId(conversationId) || 'chat';
  const mid = safeId(messageId) || 'msg';
  return `generated/${uid}/${cid}/${ts}-${mid}.jpg`;
}

async function fetchGeneratedImage(req, { prompt, seed = 1, width = 1280, height = 1280, unsafe = false }) {
  const origin = new URL(req.url).origin;
  const params = new URLSearchParams({
    prompt,
    seed: String(seed),
    width: String(width),
    height: String(height),
    unsafe: unsafe ? '1' : '0',
  });
  const response = await fetch(`${origin}/api/generate-image?${params.toString()}`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Image generation failed (${response.status}) ${text}`.trim());
  }
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  const safety = String(response.headers.get('x-mira-safety') || '').toLowerCase() === 'unsafe' ? 'unsafe' : 'safe';
  const bytes = await response.arrayBuffer();
  if (!bytes || bytes.byteLength === 0) {
    throw new Error('Generated image is empty');
  }
  return { bytes, contentType, safety };
}

async function handlePersistImage(req, body) {
  const prompt = cleanPrompt(body?.prompt || '');
  const userId = safeId(body?.userId || '');
  const conversationId = safeId(body?.conversationId || '');
  const messageId = safeId(body?.messageId || '');

  if (!prompt) return json({ error: 'Missing prompt' }, 400);
  if (prompt.length < 3 || INVALID_PROMPT_PATTERN.test(prompt)) {
    return json({ error: 'The generated image prompt is incomplete.' }, 400);
  }
  if (!userId || !conversationId || !messageId) {
    return json({ error: 'userId, conversationId and messageId are required' }, 400);
  }

  const suppliedSeed = Number(body?.seed);
  const seed = Number.isFinite(suppliedSeed) && suppliedSeed > 0 ? suppliedSeed : promptSeed(prompt);
  const width = Number(body?.width || 1280) || 1280;
  const height = Number(body?.height || 1280) || 1280;
  const unsafe = body?.unsafe === true || body?.unsafe === '1';

  const { bytes, contentType, safety } = await fetchGeneratedImage(req, {
    prompt,
    seed,
    width,
    height,
    unsafe,
  });

  const promptMarkedNsfw = NSFW_PROMPT_PATTERN.test(prompt);
  const nsfw = safety === 'unsafe' || promptMarkedNsfw;
  const effectiveSafety = nsfw ? 'unsafe' : 'safe';

  const pathname = buildImagePath({ userId, conversationId, messageId });
  const blob = await put(pathname, bytes, {
    access: 'public',
    addRandomSuffix: false,
    contentType,
    cacheControlMaxAge: RETENTION_MS / 1000,
  });

  const expiresAt = Date.now() + RETENTION_MS;
  return json({
    image: {
      url: blob.url,
      pathname,
      contentType,
      provider: 'pollinations',
      prompt,
      safety: effectiveSafety,
      nsfw,
      createdAt: Date.now(),
      expiresAt,
    },
  });
}

async function handleDelete(body) {
  const userId = safeId(body?.userId || '');
  const items = Array.isArray(body?.pathnames) ? body.pathnames : [];
  if (!userId || items.length === 0) return json({ deleted: 0 });

  const ownPrefix = `generated/${userId}/`;
  const toDelete = items
    .map((value) => String(value || ''))
    .filter((value) => value.startsWith(ownPrefix));

  if (toDelete.length === 0) return json({ deleted: 0 });

  await Promise.allSettled(toDelete.map((pathname) => del(pathname)));
  return json({ deleted: toDelete.length });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const action = String(body?.action || '').trim();

    if (action === 'persist-image') {
      return await handlePersistImage(req, body);
    }
    if (action === 'delete') {
      return await handleDelete(body);
    }

    return json({ error: 'Unsupported action' }, 400);
  } catch (error) {
    return json({ error: error?.message || 'Media request failed' }, 500);
  }
}
