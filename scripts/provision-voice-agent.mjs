// Run explicitly after setting ELEVENLABS_API_KEY in .env.local. Never runs at build time.
import fs from 'node:fs';
import { voiceAgentConfiguration } from '../api/_voiceAgent.js';
for (const path of ['.env.local', '.env']) if (fs.existsSync(path)) process.loadEnvFile(path);
if (!process.env.ELEVENLABS_API_KEY) throw Error('ELEVENLABS_API_KEY is required.');
const file = '.env.local';
const existing = process.env.ELEVENLABS_VOICE_AGENT_ID;
const config = voiceAgentConfiguration();
const headers = { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' };
const root = 'https://api.elevenlabs.io/v1/convai/agents';
const result = await fetch(existing ? `${root}/${encodeURIComponent(existing)}` : `${root}/create`, {
  method: existing ? 'PATCH' : 'POST', headers, body: JSON.stringify(config), signal: AbortSignal.timeout(30000),
});
if (!result.ok) { console.error(`Agent configuration failed: HTTP ${result.status}`); process.exit(1); }
const data = await result.json();
const id = existing || data.agent_id;
if (!/^agent_[a-zA-Z0-9]+$/.test(id || '')) throw Error('Invalid agent creation receipt. Inspect the ElevenLabs dashboard before retrying.');
// Persist receipt before readback so a failed verification never causes duplicate creation.
const env = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
fs.writeFileSync(file, env.replace(/^ELEVENLABS_VOICE_AGENT_ID=.*\n?/gm, '').trimEnd() + `\nELEVENLABS_VOICE_AGENT_ID=${id}\n`, { mode: 0o600 });
const verify = await fetch(`${root}/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(15000) });
if (!verify.ok) throw Error('Agent saved locally but readback failed.');
const saved = await verify.json();
if (saved.conversation_config?.agent?.prompt?.prompt !== config.conversation_config.agent.prompt.prompt || saved.platform_settings?.auth?.enable_auth !== true) throw Error('Agent readback does not match the requested private configuration.');
const expectedLanguages = Object.keys(config.conversation_config.language_presets);
if (expectedLanguages.some(code => !saved.conversation_config.language_presets?.[code]) || saved.conversation_config.agent.hinglish_mode !== true || saved.conversation_config.agent.prompt.built_in_tools?.language_detection?.params?.only_at_conversation_start !== false) throw Error('Multilingual settings were not saved correctly.');
console.log(JSON.stringify({ agentId: id, name: saved.name, promptVerified: true, privateAgent: true, voice: saved.conversation_config.tts.voice_id }));
