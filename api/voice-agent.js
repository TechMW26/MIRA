import { guardRequest } from './_requestSecurity.js';
import { authenticateMiraAccount } from './auth.js';
import { issueVoiceToken } from './_voiceAgent.js';

export async function POST(request) {
  const headers = { 'Cache-Control': 'private, no-store' };
  const reply = (body, status = 200) => Response.json(body, { status, headers });
  const blocked = guardRequest(request, { key: 'voice-agent', limit: 12 });
  if (blocked) return blocked;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || JSON.stringify(body).length > 6000) return reply({ error: 'Invalid voice session request.' }, 400);
    const account = await authenticateMiraAccount(request, body);
    if (!account?.uid) return reply({ error: 'Please sign in to start a voice conversation.' }, 401);
    return reply({ conversationToken: await issueVoiceToken() });
  } catch (error) {
    return reply({ error: error.status ? error.message : 'Voice is temporarily unavailable. Please try again.' }, error.status || 503);
  }
}
