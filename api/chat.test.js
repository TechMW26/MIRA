import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUpstreamPayload,
  selectModelForRequest,
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

test('server Auto routing follows latest-message complexity', () => {
  assert.equal(
    resolveModelChoice('auto', false, false, [{ role: 'user', content: 'Hello' }]),
    process.env.MIRA_LITE_MODEL || process.env.GEMINI_PRIMARY_MODEL || 'gemini-2.5-flash',
  );
  assert.equal(
    resolveModelChoice('auto', false, false, [{ role: 'user', content: 'Build a React component with validation' }]),
    process.env.MIRA_MODEL || 'mira-v4',
  );
  assert.equal(
    resolveModelChoice('auto', false, false, [{ role: 'user', content: 'Design an in-depth distributed system architecture step-by-step' }]),
    process.env.MIRA_PRO_MODEL || 'mira-pro',
  );
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
  assert.equal('num_ctx' in payload.options, false);
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

test('uses only the selected model with no fallback chain', () => {
  assert.equal(selectModelForRequest('mira-v4'), 'mira-v4');
  assert.equal(selectModelForRequest('mira-pro'), 'mira-pro');
  assert.equal(selectModelForRequest('gemini-2.5-flash'), 'gemini-2.5-flash');
});
