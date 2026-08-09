import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import {
  buildMechanicalSummary,
  buildXListSummaryPrompt,
  summarizeXList,
  xListSummaryIndexPath,
  xListSummaryPath,
} from '../src/x-list-summary.js';
import { xListsDir } from '../src/paths.js';

async function withTempRoot<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.FT_DATA_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-x-list-summary-'));
  process.env.FT_DATA_DIR = root;
  try {
    await mkdir(xListsDir(), { recursive: true });
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
  }
}

const digest = {
  listId: '197',
  fetchedAt: '2026-06-24T12:00:00.000Z',
  tweets: [
    {
      id: '1',
      timelineKind: 'list-tweet',
      url: 'https://x.com/alice/status/1',
      author: 'alice',
      authorName: 'Alice',
      postedAt: '2026-06-24T10:00:00.000Z',
      text: 'New agents paper https://arxiv.org/abs/1234.5678',
      links: ['https://arxiv.org/abs/1234.5678'],
      engagement: { likeCount: 10, repostCount: 4, replyCount: 2, quoteCount: 1, viewCount: 1000 },
    },
    {
      id: '2',
      timelineKind: 'list-tweet',
      url: 'https://x.com/bob/status/2',
      author: 'bob',
      authorName: 'Bob',
      postedAt: '2026-06-24T11:00:00.000Z',
      text: 'Big model release',
      links: ['https://github.com/example/repo'],
      engagement: { likeCount: 500, repostCount: 100, replyCount: 20, quoteCount: 5, viewCount: 90000 },
    },
    {
      id: '3',
      timelineKind: 'conversation-context',
      url: 'https://x.com/carol/status/3',
      author: 'carol',
      authorName: 'Carol',
      postedAt: '2026-06-24T09:00:00.000Z',
      text: 'context reply',
      links: [],
      engagement: { likeCount: 1, repostCount: 0, replyCount: 0, quoteCount: 0, viewCount: 10 },
    },
  ],
  stats: { count: 3, fetchedCount: 3, timeFilteredCount: 3, quotedOriginalsDropped: 0, pagesFetched: 1, stopReason: 'exhausted', sinceHours: 24 },
};

async function writeDigest(): Promise<void> {
  await writeFile(path.join(xListsDir(), '197-latest.json'), JSON.stringify(digest), { mode: 0o600 });
}

test('buildXListSummaryPrompt ranks by engagement and excludes conversation context', () => {
  const prompt = buildXListSummaryPrompt(digest as never, 10);
  assert.match(prompt, /SYSTEM: You are a research analyst/);
  // bob (higher engagement) before alice; carol excluded.
  const bobIndex = prompt.indexOf('@bob');
  const aliceIndex = prompt.indexOf('@alice');
  assert.ok(bobIndex > -1 && aliceIndex > -1 && bobIndex < aliceIndex);
  assert.ok(!prompt.includes('@carol'));
  assert.match(prompt, /https:\/\/github\.com\/example\/repo/);
});

test('summarizeXList writes dated summary and latest pointer via injected invoke', async () => {
  await withTempRoot(async () => {
    await writeDigest();
    const result = await summarizeXList('197', {
      invoke: async () => '## Top themes\n**Agents** — everyone is talking about agents.\n[@alice](https://x.com/alice/status/1)',
      now: new Date('2026-06-24T13:00:00.000Z'),
    });
    assert.equal(result.usedLlm, true);
    assert.equal(result.date, '2026-06-24');
    assert.equal(result.summaryPath, xListSummaryPath('2026-06-24'));
    const written = fs.readFileSync(result.summaryPath, 'utf8');
    assert.match(written, /synthesis: llm/);
    assert.match(written, /## Top themes/);
    const latest = fs.readFileSync(path.join(xListsDir(), '197-summary-latest.md'), 'utf8');
    assert.equal(latest, written);
    assert.match(fs.readFileSync(xListSummaryIndexPath(), 'utf8'), /2026-06-24\.md/);
  });
});

test('summarizeXList falls back to mechanical summary when the engine fails', async () => {
  await withTempRoot(async () => {
    await writeDigest();
    const result = await summarizeXList('197', {
      invoke: async () => {
        throw new Error('engine down');
      },
      now: new Date('2026-06-24T13:00:00.000Z'),
    });
    assert.equal(result.usedLlm, false);
    assert.equal(result.llmError, 'engine down');
    const written = fs.readFileSync(result.summaryPath, 'utf8');
    assert.match(written, /synthesis: mechanical/);
    assert.match(written, /## Top posts/);
  });
});

test('summarizeXList skips an existing summary unless forced', async () => {
  await withTempRoot(async () => {
    await writeDigest();
    const now = new Date('2026-06-24T13:00:00.000Z');
    const first = await summarizeXList('197', { invoke: async () => '## Top themes\nfirst', now });
    assert.equal(first.skipped, undefined);
    const second = await summarizeXList('197', { invoke: async () => '## Top themes\nsecond', now });
    assert.equal(second.skipped, true);
    const forced = await summarizeXList('197', { invoke: async () => '## Top themes\nthird', now, force: true });
    assert.equal(forced.skipped, undefined);
    assert.match(fs.readFileSync(forced.summaryPath, 'utf8'), /third/);
  });
});

test('buildMechanicalSummary lists top posts and links', () => {
  const summary = buildMechanicalSummary(digest as never);
  assert.match(summary, /## Top posts/);
  assert.match(summary, /@bob/);
  assert.match(summary, /github\.com\/example\/repo/);
});
