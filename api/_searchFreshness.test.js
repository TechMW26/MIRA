import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFreshnessIntent, freshnessWindow, rankFreshResults } from './_searchFreshness.js';

test('detects fresh-information requests and selects a tight window', () => {
  assert.equal(detectFreshnessIntent('latest AI news'), true);
  assert.equal(detectFreshnessIntent('explain photosynthesis'), false);
  assert.equal(freshnessWindow('breaking news today').maxAgeDays, 2);
  assert.equal(freshnessWindow('latest release').maxAgeDays, 7);
});

test('keeps only the newest dated cohort for fresh searches', () => {
  const now = Date.parse('2026-06-18T12:00:00Z');
  const ranked = rankFreshResults([
    { title: 'Old', url: 'https://example.com/old', publishedAt: '2025-01-01' },
    { title: 'Newest', url: 'https://example.com/new', publishedAt: '2026-06-18T08:00:00Z' },
    { title: 'Recent', url: 'https://example.com/recent', publishedAt: '2026-06-17T08:00:00Z' },
    { title: 'Undated', url: 'https://example.com/undated' },
  ], { maxAgeDays: 7, now });

  assert.deepEqual(ranked.map((item) => item.title), ['Newest', 'Recent']);
});

