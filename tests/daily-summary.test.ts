import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSavedText, truncateAtBoundary } from '../src/daily/summary.js';
import { buildReviewAnswer } from '../src/daily/review.js';

const PROSE = 'Ishan Anand presents a practical field guide for building and evaluating LLM-based synthetic personas. '
  + 'The central argument is that personas can forecast attitudes and some behaviors, but they are not interchangeable '
  + 'with human participants: prompt sensitivity, mode effects, and demographic flattening all bite hard in practice.';

test('summary: truncation stops at a sentence boundary when one is close to the budget', () => {
  const trimmed = truncateAtBoundary(PROSE, 120);
  assert.equal(trimmed, 'Ishan Anand presents a practical field guide for building and evaluating LLM-based synthetic personas.');
  assert.ok(!trimmed.endsWith('…'));
});

test('summary: truncation without a nearby sentence end cuts on a word boundary and marks the elision', () => {
  const trimmed = truncateAtBoundary(PROSE, 60);
  assert.ok(trimmed.endsWith('…'), trimmed);
  assert.ok(trimmed.length <= 60, trimmed);
  assert.ok(PROSE.startsWith(trimmed.slice(0, -1)), trimmed);
});

test('summary: text within the budget is returned whole', () => {
  assert.equal(truncateAtBoundary('short enough', 100), 'short enough');
});

test('review: reveal answers end on a boundary instead of mid-word', () => {
  const answer = buildReviewAnswer({
    id: 'canonical:1',
    canonicalUrl: 'https://example.com/personas',
    displayTitle: 'Persona Engineering: A Field Guide',
    searchText: `Persona Engineering: A Field Guide\n${PROSE}\npersonas\nexample.com`,
    sources: ['youtube'],
    firstSavedAt: '2026-08-05T00:00:00.000Z',
  });

  assert.ok(!answer.startsWith('Persona Engineering: A Field Guide'), answer);
  assert.ok(answer.startsWith('Ishan Anand presents'), answer);
  assert.ok(/[.!?…]$/.test(answer), answer);
});

test('summary: an explicit summary line wins over the surrounding index text', () => {
  const summary = summarizeSavedText(
    { displayTitle: 'A talk', searchText: 'A talk\nsome body text\nSummary: the speaker argues that evals beat vibes.' },
    200,
  );
  assert.equal(summary, 'the speaker argues that evals beat vibes.');
});
