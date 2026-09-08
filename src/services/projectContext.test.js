import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectContextPrompt,
  buildProjectContextTurn,
  summarizeProjectText,
} from './projectContext.js';

test('project summaries are bounded and omit raw image data', () => {
  const raw = `Useful project decision. data:image/png;base64,${'a'.repeat(1400)} Final note.`;
  const summary = summarizeProjectText(raw, 180);
  assert.ok(summary.length <= 181);
  assert.doesNotMatch(summary, /data:image|a{100}/i);
});

test('project turn retains document and image digests without binary attachments', () => {
  const turn = buildProjectContextTurn({
    userText: 'Review the launch plan',
    assistantText: 'The launch should begin with the private beta.',
    attachments: [{ name: 'plan.docx', type: 'application/docx', parsedText: 'Private beta starts in October.' }],
    imageAnalyses: [{ name: 'wireframe.png', summary: 'A mobile onboarding wireframe with three steps.' }],
    author: { uid: 'u1', displayName: 'Aviraj' },
  });
  assert.equal(turn.documents[0].name, 'plan.docx');
  assert.match(turn.documents[0].summary, /October/);
  assert.match(turn.images[0].summary, /onboarding/);
  assert.equal('base64' in turn.images[0], false);
});

test('project prompt shares other-chat context and labels summarized evidence', () => {
  const prompt = buildProjectContextPrompt({
    conversations: {
      current: { turns: { one: { timestamp: 1, conversationTitle: 'Current', author: { displayName: 'A' }, request: 'Current request', outcome: 'Current result' } } },
      other: { turns: { two: { timestamp: 2, conversationTitle: 'Research', author: { displayName: 'B' }, request: 'Analyze customers', outcome: 'Primary segment is teams.', documents: [{ name: 'research.pdf', summary: 'Interview findings from 40 teams.' }] } } },
    },
  }, { currentConversationId: 'current' });
  assert.match(prompt, /PROJECT SHARED CONTEXT/);
  assert.match(prompt, /another project chat/);
  assert.match(prompt, /research\.pdf/);
  assert.match(prompt, /not claim these summaries are verbatim/i);
});

test('project prompt retains document truth even when its turn is older than recent chat digests', () => {
  const turns = {};
  for (let index = 0; index < 18; index += 1) {
    turns[`turn-${index}`] = {
      timestamp: index + 2,
      conversationTitle: 'Ongoing work',
      request: `Request ${index}`,
      outcome: `Outcome ${index}`,
    };
  }
  turns.documentTurn = {
    timestamp: 1,
    conversationTitle: 'CANACT specification',
    request: 'Study the attached product specification.',
    outcome: 'The document defines the CANACT application.',
    documents: [{ name: 'CANACT-spec.docx', summary: 'CANACT includes onboarding, KYC, a local activity feed, and help requests.' }],
  };
  const prompt = buildProjectContextPrompt({ conversations: { canact: { turns } } });
  assert.match(prompt, /CANACT-spec\.docx/);
  assert.match(prompt, /onboarding, KYC/);
});

test('project prompt includes persistent instructions and uploaded references without chat history', () => {
  const prompt = buildProjectContextPrompt({
    projectProfile: {
      instructions: 'Use the CANACT terminology and write for product managers.',
      documents: {
        spec: { name: 'CANACT requirements.docx', summary: 'CANACT uses verified profiles and a local activity feed.' },
      },
    },
  });
  assert.match(prompt, /PROJECT INSTRUCTIONS/);
  assert.match(prompt, /product managers/);
  assert.match(prompt, /CANACT requirements\.docx/);
  assert.match(prompt, /verified profiles/);
});
