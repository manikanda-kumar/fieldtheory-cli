import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKMARK_CATEGORIES, buildCategoryPrompt, extractJsonArray, parseCategoryResponse, parseDomainResponse } from '../src/bookmark-classify-llm.js';

test('extractJsonArray: stops at the end of the first balanced JSON array', () => {
  const raw = `Here you go:
[{"id":"1","domains":["ai","finance"],"primary":"ai"}]

Some of [these bookmarks] look ambiguous.`;

  assert.equal(
    extractJsonArray(raw),
    '[{"id":"1","domains":["ai","finance"],"primary":"ai"}]',
  );
});

test('extractJsonArray: skips bracketed prose before the real JSON array', () => {
  const raw = `Status [draft only]
[{"id":"1","domains":["ai"],"primary":"ai"}]`;

  assert.equal(
    extractJsonArray(raw),
    '[{"id":"1","domains":["ai"],"primary":"ai"}]',
  );
});

test('extractJsonArray: ignores brackets inside JSON strings', () => {
  const raw = '[{"id":"1","domains":["ai"],"primary":"ai","note":"keep [this] literal"}] trailing ]';

  assert.equal(
    extractJsonArray(raw),
    '[{"id":"1","domains":["ai"],"primary":"ai","note":"keep [this] literal"}]',
  );
});

test('category prompt and parser constrain output to bookmark formats, not subject domains', () => {
  assert.deepEqual(BOOKMARK_CATEGORIES, [
    'tool', 'security', 'technique', 'launch', 'research', 'opinion', 'commerce',
    'reference', 'person', 'unclassified',
  ]);
  const prompt = buildCategoryPrompt([{ id: '1', text: 'Profile', authorHandle: null, links: null }]);
  assert.match(prompt, /Use ONLY the categories listed above/);
  assert.match(prompt, /reference: documentation/);
  assert.match(prompt, /person: profiles/);
  assert.doesNotMatch(prompt, /You may create new categories/);

  const raw = JSON.stringify([
    { id: '1', categories: ['health'], primary: 'health' },
    { id: '2', categories: ['tool', 'ai'], primary: 'tool' },
    { id: '3', categories: ['reference'], primary: 'reference' },
    { id: '4', categories: ['PERSON'], primary: 'PERSON' },
    { id: '5', categories: ['unclassified'], primary: 'unclassified' },
    { id: '6', categories: ['unclassified', 'tool'], primary: 'tool' },
    { id: '7', categories: ['tool'], primary: 'research' },
  ]);
  assert.deepEqual(parseCategoryResponse(raw, new Set(['1', '2', '3', '4', '5', '6', '7'])), [
    { id: '3', categories: ['reference'], primary: 'reference' },
    { id: '4', categories: ['person'], primary: 'person' },
    { id: '5', categories: ['unclassified'], primary: 'unclassified' },
  ]);
});

test('domain parser accepts open subject-domain slugs without leaking them into categories', () => {
  const raw = `Model answer:\n${JSON.stringify([
    { id: '1', domains: ['ai', 'health'], primary: 'health' },
    { id: '2', domains: ['new-field'], primary: 'new-field' },
  ])}`;
  const ids = new Set(['1', '2']);
  assert.deepEqual(parseDomainResponse(raw, ids), [
    { id: '1', categories: ['ai', 'health'], primary: 'health' },
    { id: '2', categories: ['new-field'], primary: 'new-field' },
  ]);
  assert.deepEqual(parseCategoryResponse(raw, ids), []);
});
