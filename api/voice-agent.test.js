import test from 'node:test';
import assert from 'node:assert/strict';
import { issueVoiceToken, voiceAgentConfiguration } from './_voiceAgent.js';
import { POST } from './voice-agent.js';

test('voice sessions require authentication before provider access', async () => {
  const result = await POST(new Request('https://itsmira.cloud/api/voice-agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }));
  assert.equal(result.status, 401);
  assert.match(result.headers.get('Cache-Control'), /no-store/);
});
test('private voice configuration has MIRA identity and honest capability limits', () => {
  const config = voiceAgentConfiguration();
  assert.equal(config.platform_settings.auth.enable_auth, true);
  assert.equal(config.platform_settings.privacy.record_voice, false);
  assert.match(config.conversation_config.agent.prompt.prompt, /MW FutureTech/);
  assert.match(config.conversation_config.agent.prompt.prompt, /receive no camera images/);
});
test('only scoped conversation token leaves the server; provider errors are sanitized', async () => {
  const env = { ELEVENLABS_API_KEY: 'test-private-key', ELEVENLABS_VOICE_AGENT_ID: 'agent_test' };
  assert.equal(await issueVoiceToken({ env, fetchImpl: async (url, options) => {
    assert.equal(url.searchParams.get('agent_id'), 'agent_test');
    assert.equal(options.headers['xi-api-key'], env.ELEVENLABS_API_KEY);
    return Response.json({ token: 'short-lived-session' });
  } }), 'short-lived-session');
  await assert.rejects(issueVoiceToken({ env, fetchImpl: async () => new Response('sensitive upstream error', { status: 401 }) }), /temporarily unavailable/);
  await assert.rejects(issueVoiceToken({ env: {} }), /not configured/);
  await assert.rejects(issueVoiceToken({ env, fetchImpl: async () => Response.json({}) }), /Could not start/);
});
