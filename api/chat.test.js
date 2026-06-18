import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUpstreamPayload,
  buildModelFallbackChain,
  getChatEndpointConfig,
  resolveModelChoice,
  toUiModelName,
} from './chat.js';

test('labels mira-v4 as normal Mira unless locked mode was requested', () => {
  assert.equal(toUiModelName('mira-v4'), 'mira');
  assert.equal(toUiModelName('mira-v4', { locked: true }), 'locked');
});

test('normal Mira stays on Mira while Locked uses the Mira Pro model', () => {
  assert.equal(resolveModelChoice('mira', false, false), process.env.MIRA_MODEL || 'mira-v4');
  assert.equal(resolveModelChoice('locked', false, false), process.env.MIRA_PRO_MODEL || 'mira-pro');
  assert.equal(resolveModelChoice('mira-pro', false, false), resolveModelChoice('locked', false, false));
});

test('forces streaming for every upstream model payload', () => {
  const common = {
    chatMessages: [{ role: 'user', content: 'Hello' }],
    toolList: [],
    safeMax: 100,
  };

  assert.equal(buildUpstreamPayload({ ...common, effectiveModel: 'mira-v4' }).stream, true);
  assert.equal(buildUpstreamPayload({ ...common, effectiveModel: 'mira-pro' }).stream, true);
  assert.equal(buildUpstreamPayload({ ...common, effectiveModel: 'mira-lite' }).body != null, true);
});

test('uses the dedicated VPS payload for Mira v4', () => {
  const payload = buildUpstreamPayload({
    effectiveModel: 'mira-v4',
    chatMessages: [{ role: 'user', content: 'Hello' }],
    toolList: [{ type: 'function' }],
    think: true,
    safeMax: 500,
  });
  assert.equal(payload.model, process.env.MIRA_MODEL || 'mira-v4');
  assert.equal(payload.stream, true);
  assert.equal(payload.options.num_ctx, Number(process.env.OLLAMA_CONTEXT_TOKENS || 8192));
  assert.equal(payload.options.temperature, 0.2);
  assert.equal(payload.options.top_p, 0.85);
  assert.equal(payload.options.repeat_penalty, 1.2);
  assert.equal('tools' in payload, false);
  assert.equal('think' in payload, false);
});

test('keeps provider ownership strict between Mira and Mira Pro', () => {
  assert.equal(getChatEndpointConfig('mira-v4').provider, 'vps');
  assert.equal(getChatEndpointConfig('mira-pro').provider, 'salad');
});

test('never falls Mira v4 through to Mira Pro or Gemini', () => {
  assert.deepEqual(buildModelFallbackChain('mira-v4'), [process.env.MIRA_MODEL || 'mira-v4']);
  assert.deepEqual(buildModelFallbackChain('mira'), [process.env.MIRA_MODEL || 'mira-v4']);
});
