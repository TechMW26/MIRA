import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessResponseQuality,
  humanizeAssistantText,
  polishAssistantAnswer,
  removeResponseRepetition,
} from './responseQuality.js';

const yachtSearch = {
  results: [{
    title: "India's most expensive yacht is owned by Lakshmi Mittal",
    snippet: 'The Amevi yacht is reported to be worth about Rs 1,000 crore.',
    url: 'https://example.com/yacht',
  }],
};

test('rejects a grounded refusal when relevant evidence exists', () => {
  const result = assessResponseQuality({
    answer: 'The provided search results do not contain this information, so I cannot answer.',
    userQuery: 'What is the most expensive yacht in India?',
    searchQuery: 'most expensive yacht in India',
    searchData: yachtSearch,
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('unjustified-grounded-refusal'));
});

test('rejects a lite-style claim that relevant search evidence was missing', () => {
  const result = assessResponseQuality({
    answer: 'I couldn’t find any information about an "Algae tree" in the provided search results.',
    userQuery: 'Tell me something about the Algae tree',
    searchQuery: 'Algae tree',
    searchData: {
      results: [{
        title: 'India installs its first Algae Tree in Bhopal',
        snippet: 'The structure uses microalgae to capture carbon dioxide.',
        url: 'https://example.com/algae-tree',
      }],
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('unjustified-grounded-refusal'));
  assert.ok(result.reasons.includes('search-process-meta-answer'));
});

test('rejects irrelevant identity and capability disclaimers', () => {
  const result = assessResponseQuality({
    answer: 'I am Mira. I cannot browse because my training data has a knowledge cutoff.',
    userQuery: 'What is the most expensive yacht in India right now?',
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes('irrelevant-identity-introduction'));
  assert.ok(result.reasons.includes('false-capability-denial'));
});

test('accepts a MIRA self-description when the user asks for it', () => {
  const result = assessResponseQuality({
    answer: "I'm MIRA, an AI assistant built by MW FutureTech.",
    userQuery: 'Tell me something about yourself!',
  });
  assert.equal(result.ok, true);
});

test('accepts a direct cited grounded answer', () => {
  const result = assessResponseQuality({
    answer: "India's most expensive yacht is reported to be Lakshmi Mittal's Amevi, valued around Rs 1,000 crore [1].",
    userQuery: 'What is the most expensive yacht in India?',
    searchQuery: 'most expensive yacht in India',
    searchData: yachtSearch,
  });
  assert.equal(result.ok, true);
});

test('polishes grounded answers without removing meaningful numbers', () => {
  const result = polishAssistantAnswer(
    'The device utilizes algae [1, 3]. Here are some key facts:\n\n- It can match 25 trees [2, 4].',
    { grounded: true },
  );
  assert.equal(result, 'The device uses algae.\n\n- It can match 25 trees.');
});

test('humanizes prose and removes em dashes without changing code blocks', () => {
  const result = humanizeAssistantText(
    'It is important to note that this works — and it feels natural.\n\n```js\nconst symbol = "—";\n```',
  );
  assert.equal(
    result,
    'This works, and it feels natural.\n\n```js\nconst symbol = "—";\n```',
  );
});

test('removes canned acknowledgments and generic closing offers', () => {
  const result = polishAssistantAnswer(
    "Certainly! OAuth uses delegated authorization.\n\nLet me know if you'd like more details!",
  );
  assert.equal(result, 'OAuth uses delegated authorization.');
  assert.equal(polishAssistantAnswer('Surety bonds protect the project owner.'), 'Surety bonds protect the project owner.');
});

test('removes a redundant grounded summary label and repairs a run-on sources heading', () => {
  const result = polishAssistantAnswer(
    '## Summary AlgaeTree captures carbon.\n\n## Sources - [Article](https://example.com)',
    { grounded: true },
  );
  assert.equal(result, 'AlgaeTree captures carbon.\n\n### Sources\n\n- [Article](https://example.com)');
});

test('removes repeated model-loop paragraphs and their trailing fragment', () => {
  const repeated = 'Maine project context se samjha hai ki Canact ek social platform hai. Isme profile verification facial biometrics ke through hoti hai.';
  const result = removeResponseRepetition([
    'Canact users ko profiles, polls, ratings aur nearby interactions deta hai.',
    repeated,
    repeated,
    repeated,
    'Maine project context se',
  ].join('\n\n'));

  assert.equal(
    result,
    `Canact users ko profiles, polls, ratings aur nearby interactions deta hai.\n\n${repeated}`,
  );
});

test('keeps intentional repetition inside fenced code', () => {
  const result = removeResponseRepetition([
    'This explanation is deliberately long enough to be considered for repetition detection.',
    '```txt\nrepeat me\nrepeat me\n```',
    'This explanation is deliberately long enough to be considered for repetition detection.',
  ].join('\n\n'));

  assert.equal(
    result,
    'This explanation is deliberately long enough to be considered for repetition detection.\n\n```txt\nrepeat me\nrepeat me\n```',
  );
});
