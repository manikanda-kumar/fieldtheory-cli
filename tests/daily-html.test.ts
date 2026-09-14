import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDigestHtml } from '../src/daily/html.js';
import type { DailyCollection } from '../src/daily/collect.js';
import type { DailyCoverage } from '../src/daily/coverage.js';
import { renderReadingGroup, renderReadingItem } from '../src/daily/reading-html.js';
import { separateReadingLinks } from '../src/daily/reading-text.js';
import { renderDigestMarkdown } from '../src/daily/synthesize.js';

test('daily references keep prose plain and link the source on the line below', () => {
  const html = renderReadingGroup({ label: 'A theme', group: 'theme-1', items: [], relatedItems: [
    { title: 'A post about agents & interfaces', url: 'https://x.com/author/status/123', byline: 'x.com' },
    { title: 'A reference without a byline', url: 'https://www.example.com/article' },
    { title: 'Unsafe <script> title', url: 'javascript:alert(1)', byline: 'Untrusted source' },
  ] });
  assert.match(html, /<li>A post about agents &amp; interfaces<span class="byline source-links"><a href="https:\/\/x.com\/author\/status\/123"[^>]*>x.com<\/a><\/span><\/li>/);
  assert.match(html, /<a href="https:\/\/www.example.com\/article"[^>]*>example.com<\/a>/);
  assert.doesNotMatch(html, /<a[^>]*>A post about|href="javascript:|<script>/);
});

test('daily text extracts URLs from saved prose and keeps punctuation outside the target', () => {
  assert.deepEqual(separateReadingLinks('Memento-Skills: observe -&gt; learn. Read https://t.co/zOMTPSc4eP" / X'), {
    text: 'Memento-Skills: observe -> learn. Read " / X', urls: ['https://t.co/zOMTPSc4eP'],
  });
  assert.deepEqual(separateReadingLinks('Read (https://example.com/docs(v2)?a=1&amp;b=2).'), {
    text: 'Read.', urls: ['https://example.com/docs(v2)?a=1&b=2'],
  });
});

test('daily links in both titles and summaries are moved to a separate source line', () => {
  const html = renderReadingItem({ title: 'Read https://t.co/one', url: 'https://x.com/post/1', body: 'More at https://example.com/?a=1&amp;b=2. &lt;script&gt;alert(1)&lt;/script&gt;' });
  assert.match(html, /<h3>Read<\/h3>/);
  assert.match(html, /href="https:\/\/t.co\/one"/);
  assert.match(html, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /<h3>[^<]*<a|<script>/);
  assert.ok(!html.match(/<p class="summary">(.*?)<\/p>/)?.[1].includes('https://'));
});

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
  assert.ok(html.includes(`<h3>${title.trim()}</h3>`));
  assert.ok(html.includes(`<p class="summary">${summary}</p>`));
  assert.match(html, /href="https:\/\/example.com\/article\?q=1&amp;lang=en"/);
  assert.match(html, /href="#theme-1"/);
  assert.ok(html.indexOf('id="theme-1"') < html.indexOf('id="recall"'));
  assert.doesNotMatch(html, /<script|<button|<input|>Open<|<details/);
  assert.equal(html.split('Further details belong inside this section.').length, 2);
  const withUrls = { ...item, displayTitle: 'Memento-Skills https://t.co/one', searchText: 'Summary: A useful summary. Read https://example.com/more.' };
  const markdown = renderDigestMarkdown({ ...collection, items: [withUrls] }, [], [{
    title: themeTitle, summary: 'A clear first sentence.', itemIds: ['one'], relatedIds: [], externalNotes: [], projects: [],
  }], [], true, new Map(), coverage);
  assert.match(markdown, /### Memento-Skills\n/);
  assert.match(markdown, /\[t.co\]\(https:\/\/t.co\/one\)/);
  assert.match(markdown, /\[example.com\]\(https:\/\/example.com\/more\)/);
  assert.doesNotMatch(markdown, /### \[|Read https?:/);

  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]));
  for (const match of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.has(match[1]));
});
