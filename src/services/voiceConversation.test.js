import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessVoiceTranscript,
  detectVoiceLanguage,
  getSpeakableIncrement,
  NEW_VOICE_CONVERSATION,
  normalizeVoiceTranscript,
  resolveVoiceConversationBinding,
  resolveVoiceTurnAnswer,
  sanitizeSpeechText,
  sanitizeVoiceOutput,
  splitSpeechText,
  updateVoiceInterruptionGate,
} from './voiceConversation.js';

test('detects Hindi from transcript hints and Devanagari text', () => {
  assert.equal(detectVoiceLanguage('Hello', 'en'), 'en');
  assert.equal(detectVoiceLanguage('नमस्ते', ''), 'hi');
  assert.equal(detectVoiceLanguage('Namaste', 'hi-IN'), 'hi');
});

test('repairs common short-utterance recognition of the Mira name', () => {
  assert.equal(normalizeVoiceTranscript('Hello, MRW.'), 'Hello, Mira.');
  assert.equal(normalizeVoiceTranscript('Hey mirror, how are you?'), 'Hey Mira, how are you?');
  assert.equal(normalizeVoiceTranscript('What is MRW?'), 'What is MRW?');
});

test('rejects repetitive and unsupported-script transcription noise', () => {
  assert.deepEqual(assessVoiceTranscript(`ව${'ං'.repeat(80)}`), {
    usable: false,
    text: '',
    reason: 'repetitive-noise',
  });
  assert.equal(assessVoiceTranscript('සිංහල අක්ෂර අහඹු පෙළ').usable, false);
});

test('keeps natural English, Hindi, Hinglish, and accented names', () => {
  assert.equal(assessVoiceTranscript('Can you hear me clearly?').usable, true);
  assert.equal(assessVoiceTranscript('नमस्ते मीरा, क्या आप मुझे सुन सकती हैं?').usable, true);
  assert.equal(assessVoiceTranscript('Mira, kal ka weather batao.').usable, true);
  assert.equal(assessVoiceTranscript('Tell me about José García.').usable, true);
});

test('turns formatted chat output into concise speakable text', () => {
  assert.equal(
    sanitizeSpeechText('## Result\n- Open [MIRA](https://itsmira.cloud).\n```js\nsecret()\n```'),
    'Result Open MIRA. Code example omitted.',
  );
});

test('sanitizes voice captions without exposing markdown or model controls', () => {
  assert.equal(
    sanitizeVoiceOutput('[MIRA_WEB_SEARCH: algae tree]\n### Result\nThe **answer** is ready. 1. **First point** 2. Second point [1].'),
    'Result\nThe answer is ready.\n1. First point\n2. Second point.',
  );
  assert.equal(
    sanitizeVoiceOutput('Let me verify that. <web.search>algae tree</web.search>'),
    'Let me verify that.',
  );
});

test('keeps the streamed voice answer when the final result is empty', () => {
  assert.equal(
    resolveVoiceTurnAnswer('', '### Answer\nHello **Aviraj**.'),
    'Answer\nHello Aviraj.',
  );
  assert.equal(
    resolveVoiceTurnAnswer('Final answer.', 'Partial answer.'),
    'Final answer.',
  );
});

test('splits long speech at sentence boundaries', () => {
  const chunks = splitSpeechText('First sentence. Second sentence. Third sentence.', 40);
  assert.deepEqual(chunks, ['First sentence. Second sentence.', 'Third sentence.']);
});

test('binds a new voice session to the conversation created by its first turn', () => {
  assert.deepEqual(resolveVoiceConversationBinding(NEW_VOICE_CONVERSATION, 'chat-1'), {
    action: 'bind',
    conversationId: 'chat-1',
  });
  assert.equal(resolveVoiceConversationBinding('chat-1', 'chat-1').action, 'keep');
  assert.equal(resolveVoiceConversationBinding('chat-1', 'chat-2').action, 'close');
});

test('streams complete clauses and bounded partial speech without waiting for a paragraph', () => {
  assert.deepEqual(getSpeakableIncrement('', 'Hello there', false), { text: '', consumed: '' });
  const first = getSpeakableIncrement('', 'Hello there, how are', false);
  assert.deepEqual(first, { text: 'Hello there,', consumed: 'Hello there,' });
  assert.deepEqual(getSpeakableIncrement(first.consumed, 'Hello there, how are you?', true), {
    text: 'how are you?',
    consumed: 'Hello there, how are you?',
  });
  const longPartial = 'This is a deliberately long spoken response that has enough words to begin playing before the model finishes its whole answer';
  assert.ok(getSpeakableIncrement('', longPartial, false).text.length >= 64);
});

test('requires sustained speech before interrupting a voice response', () => {
  const started = updateVoiceInterruptionGate(0, 0.08, 1_000);
  assert.deepEqual(started, { startedAt: 1_000, triggered: false });
  assert.equal(updateVoiceInterruptionGate(started.startedAt, 0.08, 1_121).triggered, true);
  assert.deepEqual(updateVoiceInterruptionGate(started.startedAt, 0.01, 1_050), {
    startedAt: 0,
    triggered: false,
  });
});
