import { guardRequest } from './_requestSecurity.js';
import { authenticateMiraAccount } from './auth.js';
import { PENDING_COOKIE, LINK_COOKIE, sealLink, unsealLink, readLink, linkCookie, talioServerRequest, pairingVerifier, linkFingerprint } from './_talioLink.js';

export async function POST(request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const reply = (data, status = 200, cookie) => Response.json(data, { status, headers: { ...headers, ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
  try {
    const blocked = guardRequest(request, { key: 'talio-link', limit: 90 });
    if (blocked) return blocked;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'A valid integration request is required.' }, 400);
    if (JSON.stringify(body).length > 128000) return reply({ error: 'Request too large.' }, 413);
    const account = await authenticateMiraAccount(request, body);
    if (!account?.uid) return reply({ error: 'Please sign into MIRA again to manage Talio access.' }, 401);
    if (body.operation === 'begin') {
      if (typeof body.allowActions !== 'boolean') return reply({ error: 'Choose read-only or workplace actions.' }, 400);
      const pair = pairingVerifier();
      const result = await talioServerRequest('device', { operation: 'start', challenge: pair.challenge, allowActions: body.allowActions });
      if (result.status !== 200) return reply({ error: result.data.error || 'Could not start linking.' }, result.status);
      const pending = { uid: account.uid, verifier: pair.verifier, deviceCode: result.data.device_code, userCode: result.data.user_code, expiresAt: Date.now() + 300000 };
      // Device credentials are never returned to JavaScript or mutable profile storage.
      return reply({ userCode: result.data.user_code, url: result.data.verification_uri_complete, expiresAt: pending.expiresAt, interval: result.data.interval }, 200,
        linkCookie(PENDING_COOKIE, sealLink(pending, PENDING_COOKIE), 300));
    }
    if (body.operation === 'poll') {
      const pending = readLink(request, PENDING_COOKIE, account.uid);
      if (!pending) return reply({ error: 'expired_token' }, 400);
      const result = await talioServerRequest('device', { operation: 'poll', userCode: pending.userCode, deviceCode: pending.deviceCode, verifier: pending.verifier });
      if (result.data.error) return reply({ error: result.data.error, interval: result.data.interval || 5 }, result.status);
      const linked = { uid: account.uid, token: result.data.access_token, expiresAt: result.data.expires_at };
      if (!/^[A-Za-z0-9_-]{43}$/.test(linked.token || '') || !Number.isFinite(linked.expiresAt) || linked.expiresAt <= Date.now()) return reply({ error: 'Invalid Talio approval response.' }, 502);
      return reply({ linked: true, account: result.data.profile, scopes: result.data.scopes }, 200,
        linkCookie(LINK_COOKIE, sealLink(linked, LINK_COOKIE), Math.floor((linked.expiresAt - Date.now()) / 1000)));
    }
    const linked = readLink(request, LINK_COOKIE, account.uid);
    if (!linked) return reply(body.operation === 'status' ? { linked: false } : { success: false, error: 'Link your Talio account in Settings first.' }, body.operation === 'status' ? 200 : 401);
    if (['protect-message', 'open-message', 'open-messages'].includes(body.operation)) {
      const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
      if (!validId(body.conversationId) || body.operation !== 'open-messages' && !validId(body.messageId)) return reply({ error: 'Invalid private message identity.' }, 400);
      const status = await talioServerRequest('gateway', { operation: 'status' }, linked.token);
      if (status.status !== 200 || status.data.linked !== true) return reply({ error: 'An active Talio connection is required for private workplace history.' }, status.status === 200 ? 401 : status.status);
      const binding = linkFingerprint(linked.token);
      const open = (sealed, messageId) => {
        if (!validId(messageId) || typeof sealed !== 'string' || sealed.length > 90000) throw Error('Invalid private message');
        const value = unsealLink(sealed, 'mira-talio-message');
        if (value.uid !== account.uid || value.binding !== binding || value.conversationId !== body.conversationId || value.messageId !== messageId || value.expiresAt <= Date.now()) throw Error('Wrong private message binding');
        return value.payload;
      };
      if (body.operation === 'open-messages') {
        if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 12) return reply({ error: 'Invalid private message batch.' }, 400);
        return reply({ messages: body.messages.map(message => { try { return { messageId: message.messageId, payload: open(message.sealed, message.messageId) }; } catch { return { messageId: message?.messageId, payload: null }; } }) });
      }
      if (body.operation === 'protect-message') {
        if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload) || JSON.stringify(body.payload).length > 60000) return reply({ error: 'Private reply is too large to synchronize securely.' }, 413);
        return reply({ sealed: sealLink({ uid: account.uid, binding, conversationId: body.conversationId, messageId: body.messageId, expiresAt: linked.expiresAt, payload: body.payload }, 'mira-talio-message') });
      }
      if (typeof body.sealed !== 'string' || body.sealed.length > 90000) return reply({ error: 'Invalid private message.' }, 400);
      try { return reply({ payload: open(body.sealed, body.messageId) }); }
      catch { return reply({ error: 'This private message belongs to a different or expired connection.' }, 403); }
    }
    if (!['status', 'disconnect', 'context', 'activity', 'action', 'receipt'].includes(body.operation)) return reply({ error: 'Unsupported workplace operation.' }, 400);
    const result = await talioServerRequest('gateway', { operation: body.operation, query: body.query, action: body.action, confirmed: body.confirmed, requestId: body.requestId, actionType: body.actionType }, linked.token);
    const cookie = body.operation === 'disconnect' && result.status === 200 || result.status === 401 ? linkCookie(LINK_COOKIE, '', 0) : null;
    return reply(result.data, result.status, cookie);
  } catch (error) { return reply({ error: error.status === 503 ? error.message : 'Talio connection is temporarily unavailable. No action was retried.' }, error.status || 503); }
}
