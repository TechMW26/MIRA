import test from 'node:test';
import assert from 'node:assert/strict';
import { assessResponseQuality } from './responseQuality.js';

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

