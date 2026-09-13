import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDigestHtml } from '../src/daily/html.js';
import type { DailyCollection } from '../src/daily/collect.js';
import type { DailyCoverage } from '../src/daily/coverage.js';

test('daily HTML keeps full headings, titled links and paragraph summaries without browser controls', () => {
  const title = 'A detailed article title that remains legible in a reading list '.repeat(3);
  const summary = 'A useful complete sentence explaining the saved material. '.repeat(7).trim();
  const themeTitle = 'A theme heading with sufficient detail to exceed the old side rail limit';
  const item = {
    id: 'one', canonicalUrl: 'https://example.com/article?q=1&lang=en', displayTitle: title,
    searchText: `${title}\nSummary: ${summary}`, sources: ['raindrop'],
    firstSavedAt: '2026-09-13T00:00:00Z', lastSavedAt: null,
    primaryCategory: null, primaryDomain: 'example.com',
  };
  const collection: DailyCollection = {
    date: '2026-09-13', sinceIso: '2026-09-12T00:00:00Z', untilIso: '2026-09-13T00:00:00Z',
    isExplicitDate: false, items: [item], carriedOver: 0, undateableExcluded: 0,
    nextWatermark: '2026-09-13T00:00:00Z', projectDeltas: [],
  };
  const coverage: DailyCoverage = {
    freshness: { x: 'unknown', raindrop: 'unknown', 'github-stars': 'unknown', rss: 'unknown', youtube: 'unknown', projects: 'unknown' },
    counts: { collected: 1, themed: 1, alsoSaved: 0, thinSkipped: 0, enriched: 0, carriedOver: 0, citationsDropped: 0, undateableExcluded: 0, synthesis: 'llm' },
  };
  const html = renderDigestHtml(collection, [], [{
    title: themeTitle, summary: 'A clear first sentence. Further details belong inside this section.',
    itemIds: ['one'], relatedIds: [], externalNotes: [], projects: [],
  }], [], true, new Map(), coverage);
  assert.ok(html.includes(`<h2>${themeTitle}</h2>`));
  assert.ok(html.includes(`${title.trim()}</a></h3>`));
  assert.ok(html.includes(`<p class="summary">${summary}</p>`));
  assert.match(html, /href="https:\/\/example.com\/article\?q=1&amp;lang=en"/);
  assert.match(html, /href="#theme-1"/);
  assert.ok(html.indexOf('id="theme-1"') < html.indexOf('id="recall"'));
  assert.doesNotMatch(html, /<script|<button|<input|>Open<|<details/);
  assert.equal(html.split('Further details belong inside this section.').length, 2);
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(match[1]));
});
