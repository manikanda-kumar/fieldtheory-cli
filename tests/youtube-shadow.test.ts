import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyYoutubeShadow, transcriptExcerpts, youtubeShadowReviews, type YoutubeShadow } from '../src/youtube/shadow.js';
import { emptyYoutubeState, markVideo, saveYoutubeState } from '../src/youtube/state.js';
import { renderDigestMarkdown, synthesizeDaily } from '../src/daily/synthesize.js';
import { renderDigestHtml } from '../src/daily/html.js';
import type { DailyCollection } from '../src/daily/collect.js';
import type { DailyCoverage } from '../src/daily/coverage.js';

const shadow: YoutubeShadow = { model: 'jev-1.13.0', rubric: 'youtube-format-v2', evidenceHash: 'hash',
  classifiedAt: '2026-09-18T00:00:00Z', label: 'interview', ruleLabel: 'tutorial', confidence: 0.97 };

test('CLI boundary validates responses, hashes evidence, and skips missing credentials or captions', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-jev-'));
  const previous = { PATH: process.env.PATH, TYPESAFE_API_KEY: process.env.TYPESAFE_API_KEY };
  try {
    process.env.PATH = `${dir}${path.delimiter}${previous.PATH}`;
    process.env.TYPESAFE_API_KEY = 'test-only';
    const binary = path.join(dir, 'jev-axi');
    const respond = async (response: unknown) => {
      await writeFile(binary, `#!${process.execPath}\nconst args = process.argv.slice(2);\nif (!args.includes('--no-cache') || !args.includes('jev-1.13.0')) process.exit(2);\nconsole.log(${JSON.stringify(JSON.stringify(response))});\n`);
      await chmod(binary, 0o700);
    };
    const valid = { pick: 'interview', confidence: 0.93, raw: [{ model: 'jev-1.13.0' }] };
    await respond(valid);
    const first = await classifyYoutubeShadow({ title: 'How to build' }, 'Guest dialogue');
    assert.equal(first?.ruleLabel, 'tutorial');
    assert.equal(first?.label, 'interview');
    assert.equal(first?.confidence, 0.93);
    assert.equal(first?.evidenceHash, (await classifyYoutubeShadow({ title: 'How to build' }, 'Guest dialogue'))?.evidenceHash);
    assert.notEqual(first?.evidenceHash, (await classifyYoutubeShadow({ title: 'How to build' }, 'Changed evidence'))?.evidenceHash);
    for (const invalid of [{ ...valid, pick: 'toString' }, { ...valid, confidence: 1.1 }, { ...valid, confidence: '0.9' }, { ...valid, raw: [{ model: 'wrong' }] }]) {
      await respond(invalid);
      await assert.rejects(classifyYoutubeShadow({ title: 'Title' }, 'Transcript'), /Invalid Jev/);
    }
    assert.equal(await classifyYoutubeShadow({ title: 'Title' }, '  '), undefined);
    delete process.env.TYPESAFE_API_KEY;
    assert.equal(await classifyYoutubeShadow({ title: 'Title' }, 'Transcript'), undefined);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});

test('excerpts preserve short text and select distinct beginning, middle and end', () => {
  assert.equal(transcriptExcerpts('short'), 'short');
  assert.equal(transcriptExcerpts('a'.repeat(6000)).length, 6000);
  const text = 'a'.repeat(2000) + 'x'.repeat(1000) + 'b'.repeat(2000) + 'y'.repeat(1000) + 'c'.repeat(2000);
  assert.equal(transcriptExcerpts(text), `${'a'.repeat(2000)}\n[... MIDPOINT ...]\n${'b'.repeat(2000)}\n[... END ...]\n${'c'.repeat(2000)}`);
});

test('review window includes start, excludes end, agreement and abstention; includes summary-only disagreements', () => {
  const state = emptyYoutubeState();
  for (const [id, patch] of Object.entries({
    start: shadow,
    end: { ...shadow, classifiedAt: '2026-09-19T00:00:00Z' },
    old: { ...shadow, classifiedAt: '2026-09-17T23:59:59Z' },
    agreement: { ...shadow, label: 'tutorial' as const },
    unknown: { ...shadow, label: 'unknown' as const },
    summaryOnly: { ...shadow, ruleLabel: 'interview' },
  })) markVideo(state, id, { shadow: patch, videoType: 'tutorial', status: 'done' });
  markVideo(state, 'legacy', { videoType: 'talk', status: 'done' });
  assert.deepEqual(youtubeShadowReviews(state, '2026-09-18T00:00:00Z', '2026-09-19T00:00:00Z').map(x => x.videoId), ['start', 'summaryOnly']);
});

test('daily markdown and HTML highlight shadow disagreements safely and omit empty section', async () => {
  const collection: DailyCollection = { date: '2026-09-18', sinceIso: '2026-09-18T00:00:00Z', untilIso: '2026-09-19T00:00:00Z',
    isExplicitDate: true, items: [], carriedOver: 0, undateableExcluded: 0, nextWatermark: '2026-09-19T00:00:00Z', projectDeltas: [] };
  const coverage: DailyCoverage = { freshness: { x: 'unknown', raindrop: 'unknown', 'github-stars': 'unknown', rss: 'unknown', youtube: 'unknown', projects: 'unknown' },
    counts: { collected: 0, themed: 0, alsoSaved: 0, thinSkipped: 0, carriedOver: 0, enriched: 0, citationsDropped: 0, undateableExcluded: 0, synthesis: 'mechanical' } };
  const reviews = [{ ...shadow, videoId: 'test-id', title: 'Guest <script> & [demo]', summaryLabel: 'talk' }];
  for (const render of [renderDigestHtml, renderDigestMarkdown]) {
    const output = render(collection, [], [], [], false, new Map(), coverage, [], 0, {}, reviews);
    assert.match(output, /YouTube classification disagreements/);
    assert.match(output, /97% confidence/);
    assert.match(output, /tutorial/);
    assert.match(output, /talk/);
    assert.match(output, /interview/);
    assert.match(output, /https:\/\/www.youtube.com\/watch\?v=test-id/);
    assert.doesNotMatch(output, /<script>/);
    assert.doesNotMatch(render(collection, [], [], [], false, new Map(), coverage), /YouTube classification disagreements/);
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-shadow-report-'));
  const previous = { FT_DATA_DIR: process.env.FT_DATA_DIR, FT_LIBRARY_DIR: process.env.FT_LIBRARY_DIR };
  try {
    process.env.FT_DATA_DIR = path.join(dir, 'data');
    process.env.FT_LIBRARY_DIR = path.join(dir, 'library');
    const state = emptyYoutubeState();
    markVideo(state, 'test-id', { shadow, title: 'Disagreement without new saves', videoType: 'talk', status: 'done' });
    await saveYoutubeState(state);
    const report = await synthesizeDaily(collection, [], { html: true });
    assert.notEqual(report.skipped, true);
    assert.match(await readFile(report.digestPath, 'utf8'), /Disagreement without new saves/);
    assert.match(await readFile(report.htmlPath!, 'utf8'), /Jev: <strong>interview/);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
