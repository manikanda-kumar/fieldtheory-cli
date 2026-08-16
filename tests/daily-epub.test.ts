import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';

import { buildEpub } from '../src/epub.js';
import { digestMarkdownToEpub } from '../src/daily/epub.js';

/** Minimal ZIP reader: walks local file headers so the tests need no dependency. */
function readZip(buffer: Buffer): Map<string, { data: Buffer; method: number; offset: number }> {
  const entries = new Map<string, { data: Buffer; method: number; offset: number }>();
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const dataStart = offset + 30 + nameLength + extraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, { data: method === 0 ? raw : inflateRawSync(raw), method, offset });
    offset = dataStart + compressedSize;
  }
  return entries;
}

const SAMPLE = `---
date: "2026-08-15"
new_items: 77
themes: 2
synthesis: llm
reviews_due: 1
---

# Daily Learning Review — 2026-08-15

> **77 new saves · 1 review due · 4 active projects**

## Recall first

### A saved talk

Saved 2026-08-03 · youtube

> Without opening it, what made you save this?

<details>
<summary>Reveal source reminder</summary>

The talk argues harness engineering beats prompt engineering.

</details>

Grade after recalling: \`ft review grade review:canonical:abc123 again|fuzzy|got-it\`

## Today's throughline

- **Agent harnesses:** Runtime beats prompt.

## Ponder

> What assumption in [[project:fieldtheory-cli]] might change?

## Today's material

## Agent harnesses

Giving agents a real runtime, not just a prompt.

- [t3code](https://github.com/pingdotgg/t3code) — github-stars, saved 2026-08-13
- [A talk](https://www.youtube.com/watch?v=abc) — youtube, saved 2026-08-15 · [notes](../youtube/2026-08/abc.md)

Active projects: [[project:fieldtheory-cli]]

## Structure-aware tooling

Making agents precise.

- [Embabel](https://example.com/embabel) — rss, saved 2026-08-14

## Also saved

- [Something else](https://example.com/else) — x, saved 2026-08-15
  A one-line summary of the item.

## Project activity

- [[project:fieldtheory-cli]] — 3 commit(s), 2 agent prompt(s)

## System details

<details>
<summary>Coverage and source freshness</summary>

Source freshness:
- x: fresh

</details>
`;

test('buildEpub stores mimetype first and uncompressed', () => {
  const epub = buildEpub({
    title: 'Test',
    identifier: 'urn:test:1',
    date: '2026-08-15',
    chapters: [{ id: 'ch-1', title: 'One', body: '<p>hi</p>' }],
  });
  const entries = readZip(epub);
  const mimetype = entries.get('mimetype');
  assert.ok(mimetype);
  assert.equal(mimetype.offset, 0);
  assert.equal(mimetype.method, 0);
  assert.equal(mimetype.data.toString('utf8'), 'application/epub+zip');
  assert.ok(entries.has('META-INF/container.xml'));
  assert.ok(entries.has('OEBPS/content.opf'));
  assert.ok(entries.has('OEBPS/nav.xhtml'));
  assert.ok(entries.has('OEBPS/toc.ncx'));
  assert.ok(entries.has('OEBPS/ch-1.xhtml'));
});

test('buildEpub declares a cover for both EPUB 3 and legacy Kindle readers', () => {
  const epub = buildEpub({
    title: 'Test',
    identifier: 'urn:test:1',
    date: '2026-08-15',
    cover: { data: Buffer.from('not-really-a-png'), mediaType: 'image/png' },
    chapters: [{ id: 'ch-1', title: 'One', body: '<p>hi</p>' }],
  });
  const entries = readZip(epub);
  // Images are already compressed, so the writer stores them.
  assert.equal(entries.get('OEBPS/cover.png')?.method, 0);

  const opf = entries.get('OEBPS/content.opf')!.data.toString('utf8');
  assert.match(opf, /<item id="cover-image" href="cover\.png" media-type="image\/png" properties="cover-image"\/>/);
  assert.match(opf, /<meta name="cover" content="cover-image"\/>/);
});

test('buildEpub points "start reading" past the front matter', () => {
  const chapters = [
    { id: 'ch-0', title: 'Cover', body: '<p>cover</p>' },
    { id: 'ch-1', title: 'One', body: '<p>hi</p>' },
  ];
  const entries = readZip(
    buildEpub({ title: 'Test', identifier: 'urn:test:1', date: '2026-08-15', startChapterId: 'ch-1', chapters }),
  );
  const nav = entries.get('OEBPS/nav.xhtml')!.data.toString('utf8');
  assert.match(nav, /epub:type="landmarks"[^>]*hidden/);
  assert.match(nav, /<a epub:type="bodymatter" href="ch-1\.xhtml">One<\/a>/);
  assert.match(entries.get('OEBPS/content.opf')!.data.toString('utf8'), /<reference type="text" title="One" href="ch-1\.xhtml"\/>/);
});

test('buildEpub emits no fixed colours, which Kindle themes would not repaint', () => {
  const entries = readZip(
    buildEpub({
      title: 'Test',
      identifier: 'urn:test:1',
      date: '2026-08-15',
      chapters: [{ id: 'ch-1', title: 'One', body: '<p>hi</p>' }],
    }),
  );
  const css = entries.get('OEBPS/style.css')!.data.toString('utf8');
  assert.doesNotMatch(css, /(^|[^-])background\s*:/);
  assert.doesNotMatch(css, /(^|[^-])color\s*:\s*#/);
});

test('buildEpub output is deterministic for the same input', () => {
  const options = {
    title: 'Test',
    identifier: 'urn:test:1',
    date: '2026-08-15',
    chapters: [{ id: 'ch-1', title: 'One', body: '<p>hi</p>' }],
  };
  assert.deepEqual(buildEpub(options), buildEpub(options));
});

test('buildEpub rejects a book with no chapters', () => {
  assert.throws(
    () => buildEpub({ title: 'Test', identifier: 'urn:test:1', date: '2026-08-15', chapters: [] }),
    /at least one chapter/,
  );
});

test('digestMarkdownToEpub splits the digest into reading chapters', () => {
  const result = digestMarkdownToEpub(SAMPLE);
  assert.equal(result.date, '2026-08-15');
  assert.equal(result.title, 'Daily Learning Review — 2026-08-15');

  const titles = result.chapters.map((chapter) => chapter.title);
  assert.deepEqual(titles, [
    'Daily Learning Review — 2026-08-15',
    'Recall first',
    "Today's throughline",
    'Ponder',
    'Agent harnesses',
    'Structure-aware tooling',
    'Also saved',
    'Project activity',
  ]);
  // Themes get positional ids; named sections keep a readable slug.
  assert.ok(result.chapters.some((chapter) => /-theme-1$/.test(chapter.id)));
  assert.ok(result.chapters.some((chapter) => /-also-saved$/.test(chapter.id)));
});

test('digestMarkdownToEpub drops terminal-only machinery', () => {
  const entries = readZip(digestMarkdownToEpub(SAMPLE).epub);
  const all = [...entries.entries()]
    .filter(([name]) => name.endsWith('.xhtml'))
    .map(([, entry]) => entry.data.toString('utf8'))
    .join('\n');

  assert.doesNotMatch(all, /ft review grade/);
  assert.doesNotMatch(all, /System details/);
  assert.doesNotMatch(all, /Source freshness/);
  assert.doesNotMatch(all, /\[\[project:/);
  // Local library links resolve to nothing inside the book.
  assert.doesNotMatch(all, /href="\.\.\/youtube/);
  assert.doesNotMatch(all, /· notes/);
});

test('digestMarkdownToEpub converts reveals, links, and bullet summaries', () => {
  const entries = readZip(digestMarkdownToEpub(SAMPLE).epub);
  const recall = entries.get('OEBPS/ch-001-recall-first.xhtml')!.data.toString('utf8');
  assert.match(recall, /<div class="reveal">/);
  assert.match(recall, /Reveal source reminder/);
  assert.match(recall, /harness engineering beats prompt engineering/);
  assert.match(recall, /<blockquote><p>Without opening it/);

  const alsoSaved = [...entries.entries()].find(([name]) => name.includes('also-saved'))![1].data.toString('utf8');
  assert.match(alsoSaved, /<a href="https:\/\/example\.com\/else">Something else<\/a>/);
  assert.match(alsoSaved, /<p class="summary">A one-line summary of the item\.<\/p>/);

  const opf = entries.get('OEBPS/content.opf')!.data.toString('utf8');
  assert.match(opf, /<dc:title>Daily Learning Review — 2026-08-15<\/dc:title>/);
  assert.match(opf, /urn:fieldtheory:daily:2026-08-15/);
});

test('digestMarkdownToEpub escapes markup that would break XHTML', () => {
  const result = digestMarkdownToEpub(`---
date: "2026-08-15"
---

# Daily Learning Review — 2026-08-15

## Also saved

- [a <script>alert(1)</script> & "quoted" title](https://example.com/x) — x, saved 2026-08-15
`);
  const entries = readZip(result.epub);
  const chapter = [...entries.entries()].find(([name]) => name.includes('also-saved'))![1].data.toString('utf8');
  assert.match(chapter, /&lt;script&gt;/);
  assert.doesNotMatch(chapter, /<script>/);
});
