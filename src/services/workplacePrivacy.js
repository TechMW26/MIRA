import { readRememberedUser } from './authSessionStore.js';
import { talioRequest } from './talioLink.js';

const privateChats = new Set(), decoded = new Map();
const chatKey = id => `${readRememberedUser()?.uid || 'signed-out'}:${id}`;
export const markWorkplaceChat = id => { if (id) privateChats.add(chatKey(id)); };
export const isWorkplaceChat = id => Boolean(id && privateChats.has(chatKey(id)));
export const PRIVATE_WORKPLACE_PLACEHOLDER = 'Private Talio message. An active connection on this device is required to view it.';
export function clearWorkplaceMemory() { decoded.clear(); }

// The legacy Firebase history/cache path receives ciphertext and a neutral
// placeholder only. Partial streaming chunks are never sent there as plaintext.
export async function protectWorkplaceMessage(conversationId, payload, request = talioRequest, messageId) {
  if (!isWorkplaceChat(conversationId)) return payload;
  const safe = Object.fromEntries(['role', 'type', 'timestamp', 'isStreaming', 'streamStartedAt'].filter(key => payload[key] !== undefined).map(key => [key, payload[key]]));
  safe.content = PRIVATE_WORKPLACE_PLACEHOLDER;
  safe.privateTalio = true;
  if (payload.isStreaming === true) return { ...safe, talioSealed: null };
  const result = await request('protect-message', { payload, conversationId, messageId });
  if (typeof result.sealed !== 'string' || !result.sealed) throw new Error('Private workplace history could not be encrypted. It was not synchronized.');
  safe.talioSealed = result.sealed;
  return safe;
}
export async function openWorkplaceMessages(conversationId, messages, request = talioRequest) {
  const uid = readRememberedUser()?.uid;
  const key = message => uid + ':' + conversationId + ':' + message.id + ':' + message.talioSealed;
  const pending = messages.filter(message => message.privateTalio && uid && message.talioSealed && !decoded.has(key(message)));
  if (messages.some(message => message.privateTalio)) markWorkplaceChat(conversationId);
  const groups = [];
  for (const message of pending) {
    let group = groups.at(-1);
    if (!group || group.length >= 12 || group.reduce((size, item) => size + item.talioSealed.length, 0) + message.talioSealed.length > 100000) groups.push(group = []);
    group.push(message);
  }
  await Promise.all(groups.map(async group => {
    try {
      const result = group.length === 1
        ? await request('open-message', { sealed: group[0].talioSealed, conversationId, messageId: group[0].id })
        : await request('open-messages', { conversationId, messages: group.map(message => ({ messageId: message.id, sealed: message.talioSealed })) });
      if (readRememberedUser()?.uid !== uid) return;
      for (const message of group) {
        const payload = group.length === 1 ? result.payload : result.messages?.find(item => item.messageId === message.id)?.payload;
        if (!payload || typeof payload !== 'object') continue;
        if (decoded.size >= 128) decoded.delete(decoded.keys().next().value);
        decoded.set(key(message), payload);
      }
    } catch { /* Fail closed: unavailable/revoked history stays a placeholder. */ }
  }));
  return messages.map(message => {
    if (!message.privateTalio) return message;
    const payload = uid && readRememberedUser()?.uid === uid ? decoded.get(key(message)) : null;
    return payload ? { ...message, ...payload, privateTalio: true } : { ...message, content: PRIVATE_WORKPLACE_PLACEHOLDER };
  });
}
