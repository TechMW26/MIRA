import test from 'node:test';
import assert from 'node:assert/strict';
import { assessResponseQuality, humanizeAssistantText, polishAssistantAnswer } from './responseQuality.js';

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
