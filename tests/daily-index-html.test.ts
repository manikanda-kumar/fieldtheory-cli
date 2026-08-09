import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildDailyIndexEntries, renderDailyIndexHtml, writeDailyIndexHtml } from '../src/daily/index-html.js';

const dailyMarkdown = (date: string, items: number, themes: number, engine: string, body: string): string => [
  '---',
  `date: "${date}"`,
  `new_items: ${items}`,
  `themes: ${themes}`,
  'synthesis: llm',
  `synthesis_engine: "${engine}"`,
  '---',
  '',
  `# Daily Learning Review — ${date}`,
  '',
  body,
  '',
].join('\n');

test('daily archive index scans dated files, extracts themes, groups months, and falls back to markdown', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-daily-index-'));
  try {
    await writeFile(path.join(dir, '2026-08-09.md'), dailyMarkdown(
      '2026-08-09', 48, 2, 'grok',
      '## Recall first\n\nold recall\n\n## Today’s throughline\n\nbrief\n\n## Agent harnesses\n\nsummary\n\n## Local inference\n\nsummary\n\n## Also saved\n\nlinks',
    ));
    await writeFile(path.join(dir, '2026-08-08.md'), dailyMarkdown(
      '2026-08-08', 7, 1, 'grok/grok-4.5',
      '## Recall first\n\nold recall\n\n## Shipping agents\n\nsummary',
    ));
    await writeFile(path.join(dir, '2025-07-31.md'), dailyMarkdown(
      '2025-07-31', 3, 1, 'mechanical',
      '## Ponder\n\nquestion\n\n## Older theme\n\nsummary',
    ));
    await writeFile(path.join(dir, '197-summary-latest.md'), dailyMarkdown(
      '2026-08-09', 999, 99, 'wrong', '## Should not be indexed',
    ));
    await writeFile(path.join(dir, '2026-08-09.txt'), 'not a dated markdown artifact');
    await writeFile(path.join(dir, '2026-08-08.html'), '<html>readable page</html>');

    const entries = await buildDailyIndexEntries(dir);
    assert.deepEqual(entries.map((entry) => entry.date), ['2026-08-09', '2026-08-08', '2025-07-31']);
    assert.equal(entries[0].itemCount, 48);
    assert.equal(entries[0].themeCount, 2);
    assert.deepEqual(entries[0].themes, ['Agent harnesses', 'Local inference']);
    assert.equal(entries[0].synthesisEngine, 'grok');
    assert.equal(entries[0].htmlPath, undefined);
    assert.match(entries[1].htmlPath ?? '', /2026-08-08\.html$/);

    const html = renderDailyIndexHtml(entries, {
      now: new Date('2026-08-09T12:00:00.000Z'),
      nav: [{ label: 'X List summaries', href: 'x-list/index.html' }],
    });
    assert.match(html, /1\.\/?.*Sun 9 aug/);
    assert.match(html, /Today/);
    assert.match(html, /August 2026/);
    assert.match(html, /July 2025/);
    assert.match(html, /href="2026-08-09\.md"/);
    assert.match(html, /href="2026-08-08\.html"/);
    assert.match(html, /48 new/);
    assert.match(html, /2 themes/);
    assert.match(html, /Agent harnesses · Local inference/);
    assert.match(html, /mechanical/);
    assert.match(html, /x-list\/index\.html/);
    assert.doesNotMatch(html, /999 new/);
    assert.doesNotMatch(html, /Recall first/);
    assert.doesNotMatch(html, /Today’s throughline/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('x-list archive index uses bold Top themes and excludes the latest pointer', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-x-list-index-'));
  try {
    await writeFile(path.join(dir, '2026-08-09.md'), [
      '---',
      'date: "2026-08-09"',
      'tweets: 1050',
      'list_tweets: 681',
      'synthesis: mechanical',
      '---',
      '',
      '# X List Daily Summary — 2026-08-09',
      '',
      '## Top themes',
      '',
      '**Cheap inference**',
      'Summary.',
      '',
      '**Agent safety**',
      'Summary.',
      '',
      '## Notable releases & links',
      '',
      'Links.',
    ].join('\n'));
    await writeFile(path.join(dir, '197-summary-latest.md'), '---\ndate: "2026-08-09"\n---\n');
    const indexPath = await writeDailyIndexHtml(dir, {
      kind: 'x-list',
      now: new Date('2026-08-09T12:00:00.000Z'),
      nav: [{ label: 'Daily reviews', href: '../index.html' }],
    });
    assert.equal(path.basename(indexPath), 'index.html');
    const html = await readFile(indexPath, 'utf8');
    assert.match(html, /1050 tweets/);
    assert.match(html, /Cheap inference · Agent safety/);
    assert.match(html, /mechanical/);
    assert.doesNotMatch(html, /summary-latest/);
    assert.match(html, /href="\.\.\/index\.html"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
