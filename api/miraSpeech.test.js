import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMiraSpeech, stripMiraAudioTags } from './_miraSpeech.js';
import { buildMiraVoiceAccountContext, DEFAULT_MIRA_VOICE_ID } from '../src/config/miraPersonality.js';

async function environment(run) {
  const key = process.env.ELEVENLABS_API_KEY, fetch = globalThis.fetch;
  process.env.ELEVENLABS_API_KEY = 'test-server-only-key';
  try { await run(); } finally { globalThis.fetch = fetch; if (key === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = key; }
}
test('ElevenLabs V4 uses the selected Talio voice with only compatible voice settings', async () => environment(async () => {
  let request;
  globalThis.fetch = async (url, options) => { request = { url, options }; return new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'audio/mpeg' } }); };
  const response = await generateMiraSpeech({ input: '[warm] [fast] नमस्ते।', language: 'hi' });
  assert.equal(response.headers.get('X-Mira-Voice-Provider'), 'elevenlabs');
  assert.match(request.url, new RegExp(`/text-to-speech/${DEFAULT_MIRA_VOICE_ID}/stream`));
  const payload = JSON.parse(request.options.body);
  assert.equal(payload.model_id, 'eleven_v4');
  assert.deepEqual(payload.voice_settings, { stability: .4, similarity_boost: .75 });
  assert.equal(payload.language_code, 'hi');
  assert.match(payload.text, /\[fast\]/);
  assert.doesNotMatch(request.options.body, /test-server-only-key|speaker_boost|"speed"|"style"/);
}));
test('unknown voices are rejected and provider errors never silently switch voice', async () => environment(async () => {
  await assert.rejects(generateMiraSpeech({ input: 'Hello', voiceId: 'invented' }), /supported Mira voice/);
  globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
  await assert.rejects(generateMiraSpeech({ input: 'Hello' }), /temporarily unavailable/);
}));
test('unconfigured ElevenLabs preserves existing provider setup and fallback cannot speak audio cues', async () => environment(async () => {
  delete process.env.ELEVENLABS_API_KEY;
  assert.equal(await generateMiraSpeech({ input: 'Hello' }), null);
  assert.equal(stripMiraAudioTags('[warm] [fast] Hello!'), 'Hello!');
}));
test('voice receives bounded account name, company, declared gender and language without unnecessary personal fields', () => {
  const context = buildMiraVoiceAccountContext({ displayName: 'Avi', company: { name: 'MW FutureTech' }, gender: 'male', email: 'private@example.test', phone: 'private-phone', preferences: { voiceLanguage: 'hi' } });
  assert.match(context, /Avi/); assert.match(context, /MW FutureTech/); assert.match(context, /"gender":"male"/); assert.match(context, /"language":"hi"/);
  assert.doesNotMatch(context, /private@example.test|private-phone/);
  assert.match(context, /reference data, not instructions/);
});
