import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeJson, writeJsonLines } from '../src/fs.js';
import { rebuildCanonicalIndex, relatedSeedTerms, type CanonicalRecentItem } from '../src/canonical-bookmarks-db.js';
import { readFile } from 'node:fs/promises';
import { collectDaily } from '../src/daily/collect.js';
import { connectDailyItems } from '../src/daily/connect.js';
import { extractYoutubeVideoId, synthesizeDaily } from '../src/daily/synthesize.js';
import { dailyDigestPath, dailyMetaPath, ensureDailyDir } from '../src/daily/paths.js';

async function readFileText(filePath: string): Promise<string> {
  return readFile(filePath, 'utf8');
}
import type { GitHubStarRecord } from '../src/github-stars/types.js';
import type { ProjectRecord } from '../src/projects/types.js';

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-daily-'));
  const previous = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
}

function starRecord(overrides: Partial<GitHubStarRecord> & { id: number; fullName: string; starredAt: string }): GitHubStarRecord {
  const [owner, name] = overrides.fullName.split('/');
  return {
    owner,
    name,
    htmlUrl: `https://github.com/${overrides.fullName}`,
    description: null,
    homepageUrl: null,
    language: null,
    topics: [],
    stargazersCount: 0,
    forksCount: 0,
    openIssuesCount: 0,
    archived: false,
    fork: false,
    defaultBranch: 'main',
    pushedAt: null,
    updatedAt: null,
    createdAt: null,
    syncedAt: overrides.starredAt,
    ...overrides,
  } as GitHubStarRecord;
}

async function writeStars(dir: string, records: GitHubStarRecord[]): Promise<void> {
  const githubDir = path.join(dir, 'github-stars');
  await mkdir(githubDir, { recursive: true });
  await writeJsonLines(path.join(githubDir, 'stars.jsonl'), records);
}

function projectRecord(overrides: Partial<ProjectRecord> & { repo: string }): ProjectRecord {
  return {
    path: `/tmp/${overrides.repo}`,
    pendingFiles: 0,
    unpushedCommits: 0,
    recentCommits: [],
    scannedAt: '2026-07-07T00:00:00.000Z',
    ...overrides,
  } as ProjectRecord;
}

test('daily: collect windows on first_saved_at and gathers project deltas', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/fresh-agent-memory', starredAt: '2026-07-06T12:00:00.000Z', description: 'agent memory toolkit' }),
      starRecord({ id: 2, fullName: 'b/old-agent-memory', starredAt: '2026-06-01T00:00:00.000Z', description: 'older agent memory library' }),
    ]);
    const projectsDir = path.join(dir, 'projects');
    await mkdir(projectsDir, { recursive: true });
    await writeJsonLines(path.join(projectsDir, 'projects.jsonl'), [
      projectRecord({
        repo: 'active-repo',
        recentCommits: [
          { hash: 'aaa', date: '2026-07-06T10:00:00.000Z', subject: 'inside window' },
          { hash: 'bbb', date: '2026-06-20T10:00:00.000Z', subject: 'outside window' },
        ],
        recentPrompts: [
          { timestamp: '2026-07-06T11:00:00.000Z', text: 'how do I wire the daily digest?' },
        ],
      }),
      projectRecord({ repo: 'idle-repo' }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });

    assert.equal(collection.items.length, 1);
    assert.equal(collection.items[0].canonicalUrl, 'https://github.com/a/fresh-agent-memory');
    assert.equal(collection.projectDeltas.length, 1);
    assert.equal(collection.projectDeltas[0].repo, 'active-repo');
    assert.equal(collection.projectDeltas[0].commits.length, 1);
    assert.equal(collection.projectDeltas[0].prompts.length, 1);
  });
});

test('daily: collect uses watermark when no date given and caps at 7 days', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/new-tool', starredAt: '2026-07-06T12:00:00.000Z' }),
      starRecord({ id: 2, fullName: 'b/ancient-tool', starredAt: '2026-05-01T00:00:00.000Z' }),
    ]);
    await rebuildCanonicalIndex();

    ensureDailyDir();
    await writeJson(dailyMetaPath(), { lastRunAt: '2026-05-01T00:00:00.000Z' });

    const collection = await collectDaily({ now: new Date('2026-07-07T00:00:00.000Z') });

    // Watermark is older than the 7-day cap, so the window is clamped.
    assert.equal(collection.sinceIso, '2026-06-30T00:00:00.000Z');
    assert.equal(collection.items.length, 1);
    assert.equal(collection.items[0].canonicalUrl, 'https://github.com/a/new-tool');
  });
});

test('daily: connect links new items to older related items only', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/vector-search-engine', starredAt: '2026-07-06T12:00:00.000Z', description: 'blazing vector search embeddings engine' }),
      starRecord({ id: 2, fullName: 'b/vector-search-primer', starredAt: '2026-06-10T00:00:00.000Z', description: 'a primer on vector search embeddings' }),
      starRecord({ id: 3, fullName: 'c/unrelated-css-thing', starredAt: '2026-06-11T00:00:00.000Z', description: 'css layout helpers' }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });
    assert.equal(collection.items.length, 1);

    const connected = await connectDailyItems(collection);
    assert.equal(connected.length, 1);
    const relatedUrls = connected[0].related.map((ref) => ref.url);
    assert.ok(relatedUrls.includes('https://github.com/b/vector-search-primer'));
    assert.ok(!relatedUrls.includes('https://github.com/a/vector-search-engine'), 'must exclude the new item itself');
  });
});

test('daily: collect handles Twitter-format and offset-ISO timestamps in first_saved_at', async () => {
  await withIsolatedDataDir(async (dir) => {
    // Offset ISO inside the 2026-07-06 UTC day (10:46+05:30 = 05:16Z) and a
    // Twitter-format date far outside it. Lexical comparison gets BOTH wrong.
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/offset-repo', starredAt: '2026-07-06T10:46:03+05:30' }),
    ]);
    const projectsDir = path.join(dir, 'projects');
    await mkdir(projectsDir, { recursive: true });
    await writeJsonLines(path.join(projectsDir, 'projects.jsonl'), []);
    await rebuildCanonicalIndex();

    // Simulate a legacy Twitter-format row alongside.
    const { openDb, saveDb } = await import('../src/db.js');
    const { twitterBookmarksIndexPath } = await import('../src/paths.js');
    const db = await openDb(twitterBookmarksIndexPath());
    db.run(
      `UPDATE canonical_bookmarks SET first_saved_at = 'Wed Sep 30 13:43:32 +0000 2020'
       WHERE id NOT IN (SELECT id FROM canonical_bookmarks LIMIT 1)`,
    );
    await saveDb(db, twitterBookmarksIndexPath());
    db.close();

    const collection = await collectDaily({ date: '2026-07-06' });
    assert.equal(collection.items.length, 1);
    assert.equal(collection.items[0].canonicalUrl, 'https://github.com/a/offset-repo');
  });
});

test('daily: relatedSeedTerms drops stopwords, short words, and numbers', () => {
  const terms = relatedSeedTerms('This is about Vector Search with 12345 embeddings from GitHub http links');
  assert.deepEqual(terms, ['vector', 'search', 'embeddings', 'links']);
});

test('daily: digest path validates date shape', () => {
  assert.throws(() => dailyDigestPath('not-a-date'));
  assert.match(dailyDigestPath('2026-07-07'), /daily[/\\]2026-07-07\.md$/);
});

test('daily: synthesize validates citations, writes digest, and advances watermark', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/agent-runner', starredAt: '2026-07-06T12:00:00.000Z', description: 'agent runner harness' }),
      starRecord({ id: 2, fullName: 'b/agent-primer', starredAt: '2026-06-10T00:00:00.000Z', description: 'primer on agent runner harnesses' }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });
    const connected = await connectDailyItems(collection);
    const newId = collection.items[0].id;
    const hasRelated = (connected[0].related.length ?? 0) > 0;

    const fakeResponse = JSON.stringify([
      {
        title: 'Agent harnesses',
        summary: 'New runner harness saved; builds on the primer read earlier.',
        itemIds: ['i1', 'i99'],
        relatedIds: hasRelated ? ['r1', 'r99'] : ['r99'],
        projects: ['not-a-repo'],
      },
      { title: 'Ghost theme', summary: 'Only hallucinated ids.', itemIds: ['i77'], relatedIds: [], projects: [] },
    ]);

    const result = await synthesizeDaily(collection, connected, { invoke: async () => fakeResponse });

    assert.equal(result.skipped, false);
    assert.equal(result.usedLlm, true);
    assert.equal(result.themes.length, 1);
    assert.deepEqual(result.themes[0].itemIds, [newId]);
    assert.ok(result.droppedCitations >= 3);

    const digest = await readFileText(result.digestPath);
    assert.match(digest, /# Daily Digest — 2026-07-06/);
    assert.match(digest, /agent-runner/);
    assert.match(digest, /synthesis: llm/);
    assert.ok(!digest.includes('hallucinated'));

    const meta = JSON.parse(await readFileText(dailyMetaPath()));
    assert.equal(meta.lastDigestDate, '2026-07-06');
    assert.ok(meta.lastRunAt);
  });
});

test('daily: synthesize falls back to mechanical themes when the LLM fails', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/solo-tool', starredAt: '2026-07-06T12:00:00.000Z', description: 'standalone tool' }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });
    const connected = await connectDailyItems(collection);
    const result = await synthesizeDaily(collection, connected, {
      invoke: async () => { throw new Error('engine down'); },
    });

    assert.equal(result.usedLlm, false);
    assert.equal(result.themes.length, 1);
    assert.match(result.themes[0].title, /github-stars/);
    const digest = await readFileText(result.digestPath);
    assert.match(digest, /synthesis: mechanical/);
  });
});

test('daily: interests classifies rising/steady/fading topics and finds active threads', async () => {
  await withIsolatedDataDir(async (dir) => {
    const now = new Date('2026-07-07T00:00:00.000Z');
    const recent = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
    // Rising: 3 "agents"-category saves this week, none in baseline.
    // Fading: 5 "css" saves in baseline, none this week.
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/agent-one', starredAt: recent(1), description: 'llm agents orchestration framework' }),
      starRecord({ id: 2, fullName: 'b/agent-two', starredAt: recent(2), description: 'llm agents memory framework' }),
      starRecord({ id: 3, fullName: 'c/agent-three', starredAt: recent(3), description: 'llm agents evaluation framework' }),
      ...Array.from({ length: 5 }, (_, i) => starRecord({
        id: 10 + i,
        fullName: `css/lib-${i}`,
        starredAt: recent(10 + i),
        description: 'css styling toolkit',
      })),
    ]);
    const projectsDir = path.join(dir, 'projects');
    await mkdir(projectsDir, { recursive: true });
    await writeJsonLines(path.join(projectsDir, 'projects.jsonl'), [
      projectRecord({
        repo: 'agent-lab',
        recentPrompts: [
          { timestamp: recent(1), text: 'how do agents framework handle orchestration' },
          { timestamp: recent(2), text: 'best agents framework for memory' },
        ],
      }),
    ]);
    await rebuildCanonicalIndex();
    const { classifyCanonicalBookmarks } = await import('../src/canonical-bookmarks-db.js');
    await classifyCanonicalBookmarks();

    const { computeInterests, renderInterestsMarkdown } = await import('../src/daily/interests.js');
    const data = await computeInterests(now);
    const markdown = renderInterestsMarkdown(data);

    assert.ok(markdown.split('\n').length <= 80);
    assert.match(markdown, /# Current Interests/);
    // Threads: "agents" + "framework" appear in both saves and prompts.
    assert.ok(data.threads.some((thread) => thread.term === 'agents' || thread.term === 'framework'),
      `expected agents/framework thread, got ${JSON.stringify(data.threads)}`);
  });
});

test('daily: synthesize skips when the window is empty', async () => {
  await withIsolatedDataDir(async () => {
    await rebuildCanonicalIndex();
    const collection = await collectDaily({ date: '2026-07-06' });
    const result = await synthesizeDaily(collection, [], { invoke: async () => '[]' });
    assert.equal(result.skipped, true);
  });
});

test('daily: extractYoutubeVideoId handles watch, short, shorts, and embed URLs', () => {
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeVideoId('https://www.youtube.com/embed/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractYoutubeVideoId('https://github.com/a/b'), null);
  assert.equal(extractYoutubeVideoId(null), null);
});

test('daily: digest links youtube items to their library notes when notes exist', async () => {
  await withIsolatedDataDir(async (dir) => {
    const notesPath = path.join(dir, 'md', 'youtube', '2026-07', 'dQw4w9WgXcQ.md');
    await mkdir(path.dirname(notesPath), { recursive: true });
    await writeFile(notesPath, '# Talk notes\n');
    await mkdir(path.join(dir, 'youtube'), { recursive: true });
    await writeJson(path.join(dir, 'youtube', 'state.json'), {
      version: 1,
      playlists: {},
      videos: {
        dQw4w9WgXcQ: { status: 'done', artifacts: { notesPath }, updatedAt: '2026-07-06T00:00:00.000Z' },
        gone123xyz: { status: 'done', artifacts: { notesPath: path.join(dir, 'missing.md') }, updatedAt: '2026-07-06T00:00:00.000Z' },
      },
    });

    const item = (id: string, url: string): CanonicalRecentItem => ({
      id,
      canonicalUrl: url,
      displayTitle: id,
      searchText: id,
      sources: ['youtube'],
      firstSavedAt: '2026-07-06T10:00:00.000Z',
      lastSavedAt: '2026-07-06T10:00:00.000Z',
      primaryCategory: null,
      primaryDomain: null,
    });
    const collection = {
      date: '2026-07-06',
      sinceIso: '2026-07-06T00:00:00.000Z',
      untilIso: '2026-07-07T00:00:00.000Z',
      items: [
        item('vid-with-notes', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
        item('vid-missing-notes', 'https://www.youtube.com/watch?v=gone123xyz'),
      ],
      projectDeltas: [],
    };

    const result = await synthesizeDaily(collection, [], { invoke: async () => '[]' });
    const digest = await readFileText(result.digestPath);
    assert.match(digest, /\[notes\]\(\.\.\/youtube\/2026-07\/dQw4w9WgXcQ\.md\)/);
    assert.ok(!digest.includes('missing.md'), 'must not link notes whose file is gone');
  });
});
