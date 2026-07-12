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
import { collectDailyCoverage } from '../src/daily/coverage.js';
import { enrichBackfill, enrichThinItems, isEnrichmentEligible, mergeEnrichmentSummaries } from '../src/daily/enrich.js';
import { openDb, saveDb } from '../src/db.js';
import { twitterBookmarksIndexPath } from '../src/paths.js';
import { buildDailyAliases, buildDailyPrompt, contentLength, extractYoutubeVideoId, synthesizeDaily } from '../src/daily/synthesize.js';
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
    // Most synthesis fixtures represent substantive saves; thin-link behavior
    // is covered explicitly below with searchText overrides.
    description: 'Detailed saved commentary about implementation tradeoffs, architecture, practical examples, and the reasons this resource is worth revisiting. '.repeat(2),
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
      starRecord({ id: 0, fullName: 'a/clamped-boundary', starredAt: '2026-06-30T00:00:00.000Z' }),
      starRecord({ id: 1, fullName: 'a/new-tool', starredAt: '2026-07-06T12:00:00.000Z' }),
      starRecord({ id: 2, fullName: 'b/ancient-tool', starredAt: '2026-05-01T00:00:00.000Z' }),
    ]);
    await rebuildCanonicalIndex();

    ensureDailyDir();
    await writeJson(dailyMetaPath(), {
      lastRunAt: '2026-05-01T00:00:00.000Z',
      // This stale cursor must not be applied to the clamped 2026-06-30 boundary.
      lastRunItemId: 'zzzzzzzz',
    });

    const collection = await collectDaily({ now: new Date('2026-07-07T00:00:00.000Z') });

    // Watermark is older than the 7-day cap, so the window is clamped.
    assert.equal(collection.sinceIso, '2026-06-30T00:00:00.000Z');
    assert.equal(collection.items.length, 2);
    assert.ok(collection.items.some((item) => item.canonicalUrl === 'https://github.com/a/clamped-boundary'));
    assert.ok(collection.items.some((item) => item.canonicalUrl === 'https://github.com/a/new-tool'));
  });
});

test('daily: overflow advances only through the oldest collected items and drains on the next run', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, Array.from({ length: 5 }, (_, index) => starRecord({
      id: index + 1,
      fullName: `overflow/item-${index + 1}`,
      starredAt: `2026-07-06T0${index}:00:00.000Z`,
    })));
    await rebuildCanonicalIndex();

    const first = await collectDaily({
      now: new Date('2026-07-07T00:00:00.000Z'),
      windowHours: 24,
      maxItems: 3,
    });
    assert.equal(first.items.length, 3);
    assert.equal(first.carriedOver, 2);
    assert.equal(first.nextWatermark, '2026-07-06T02:00:00.000Z');

    await synthesizeDaily(first, [], { invoke: async () => { throw new Error('offline'); } });
    const firstDigest = await readFileText(dailyDigestPath(first.date));
    assert.match(firstDigest, /collected: 3/);
    assert.match(firstDigest, /themed: 3/);
    assert.match(firstDigest, /also_saved: 0/);
    assert.match(firstDigest, /carried_over: 2/);
    assert.match(firstDigest, /This run: collected 3; themed 3; also-saved 0; thin links skipped from synthesis 0; carried-over 2;/);
    const meta = JSON.parse(await readFileText(dailyMetaPath()));
    assert.equal(meta.lastRunAt, '2026-07-06T02:00:00.000Z');
    assert.ok(meta.lastRunItemId);

    const second = await collectDaily({
      now: new Date('2026-07-07T00:00:00.000Z'),
      maxItems: 3,
    });
    assert.equal(second.items.length, 2);
    assert.equal(second.carriedOver, 0);
    assert.deepEqual(second.items.map((item) => item.canonicalUrl), [
      'https://github.com/overflow/item-4',
      'https://github.com/overflow/item-5',
    ]);
  });
});

test('daily: explicit date synthesis does not move the rolling watermark', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'history/item', starredAt: '2026-07-01T12:00:00.000Z' }),
    ]);
    await rebuildCanonicalIndex();
    ensureDailyDir();
    await writeJson(dailyMetaPath(), {
      lastRunAt: '2026-07-10T00:00:00.000Z',
      lastDigestDate: '2026-07-10',
    });

    const historical = await collectDaily({ date: '2026-07-01' });
    await synthesizeDaily(historical, [], { invoke: async () => { throw new Error('offline'); }, force: true });

    const meta = JSON.parse(await readFileText(dailyMetaPath()));
    assert.deepEqual(meta, {
      lastRunAt: '2026-07-10T00:00:00.000Z',
      lastDigestDate: '2026-07-10',
    });
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

test('daily: synthesize validates citations, writes digest, and advances the rolling watermark', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/agent-runner', starredAt: '2026-07-06T12:00:00.000Z', description: 'agent runner harness with detailed notes on orchestration, evaluation, implementation choices, failure recovery, and practical usage patterns for teams. '.repeat(2) }),
      starRecord({ id: 2, fullName: 'b/agent-primer', starredAt: '2026-06-10T00:00:00.000Z', description: 'primer on agent runner harnesses' }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ now: new Date('2026-07-07T00:00:00.000Z') });
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
    assert.match(digest, /# Daily Digest — 2026-07-07/);
    assert.match(digest, /agent-runner/);
    assert.match(digest, /synthesis: llm/);
    assert.ok(!digest.includes('hallucinated'));
    assert.ok(!digest.includes('## Also saved'));

    const meta = JSON.parse(await readFileText(dailyMetaPath()));
    assert.equal(meta.lastDigestDate, '2026-07-07');
    assert.ok(meta.lastRunAt);
  });
});

test('daily: synthesize falls back to mechanical themes when the LLM fails', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/solo-tool', starredAt: '2026-07-06T12:00:00.000Z', description: 'standalone tool with detailed commentary about architecture, deployment tradeoffs, operational considerations, and practical implementation guidance. '.repeat(2) }),
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
    assert.match(digest, /## Coverage/);
    assert.match(digest, /- raindrop: never synced/);
  });
});

test('daily: X coverage freshness uses the newest full or incremental sync timestamp', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeJson(path.join(dir, 'bookmarks-meta.json'), {
      lastIncrementalSyncAt: '2026-07-06T10:00:00.000Z',
      lastFullSyncAt: '2026-07-06T12:00:00.000Z',
    });
    const coverage = await collectDailyCoverage({
      collected: 0,
      themed: 0,
      alsoSaved: 0,
      thinSkipped: 0,
      carriedOver: 0,
      citationsDropped: 0,
      undateableExcluded: 0,
      synthesis: 'mechanical',
    });
    assert.equal(coverage.freshness.x, '2026-07-06T12:00:00.000Z');
  });
});

test('daily: coverage counts canonical rows excluded for undateable first_saved_at', async () => {
  await withIsolatedDataDir(async () => {
    await writeStars(process.env.FT_DATA_DIR!, Array.from({ length: 4 }, (_, index) => starRecord({
      id: index + 1,
      fullName: `undateable/item-${index + 1}`,
      starredAt: '2026-07-06T12:00:00.000Z',
    })));
    await rebuildCanonicalIndex();

    const { openDb, saveDb } = await import('../src/db.js');
    const { twitterBookmarksIndexPath } = await import('../src/paths.js');
    const db = await openDb(twitterBookmarksIndexPath());
    const rows = db.exec('SELECT id, canonical_url FROM canonical_bookmarks ORDER BY id ASC')[0]?.values ?? [];
    const ids = rows.map((row) => String(row[0]));
    const excludedUrls = rows.slice(0, 3).map((row) => String(row[1]));
    db.run('UPDATE canonical_bookmarks SET first_saved_at = NULL WHERE id = ?', [ids[0]]);
    db.run("UPDATE canonical_bookmarks SET first_saved_at = 'not a date' WHERE id = ?", [ids[1]]);
    db.run("UPDATE canonical_bookmarks SET first_saved_at = 'also not a date' WHERE id = ?", [ids[2]]);
    await saveDb(db, twitterBookmarksIndexPath());
    db.close();

    const collection = await collectDaily({ date: '2026-07-06' });
    assert.equal(collection.items.length, 1);
    assert.equal(collection.undateableExcluded, 3);
    const result = await synthesizeDaily(collection, [], { invoke: async () => { throw new Error('offline'); } });
    const digest = await readFileText(result.digestPath);
    assert.match(digest, /undateable_excluded: 3/);
    assert.match(digest, /undateable excluded \(canonical total\) 3/);
    for (const url of excludedUrls) assert.ok(!digest.includes(url));
  });
});

test('daily: synthesize suppresses duplicate valid citations without counting them as dropped', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'duplicate/item', starredAt: '2026-07-06T12:00:00.000Z' }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });
    const result = await synthesizeDaily(collection, [], {
      invoke: async () => JSON.stringify([
        { title: 'First', summary: 'The saved item.', itemIds: ['i1'], relatedIds: [], projects: [] },
        { title: 'Duplicate', summary: 'The same saved item.', itemIds: ['i1'], relatedIds: [], projects: [] },
      ]),
    });

    assert.equal(result.droppedCitations, 0);
    assert.equal(result.themedCount, 1);
    assert.equal(result.alsoSavedCount, 0);
    const digest = await readFileText(result.digestPath);
    assert.equal(digest.match(/^- \[/gm)?.length, 1);
  });
});

test('daily: synthesize renders uncited items under Also saved', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, Array.from({ length: 11 }, (_, index) => starRecord({
      id: index + 1,
      fullName: `saved/item-${index + 1}`,
      starredAt: '2026-07-06T12:00:00.000Z',
    })));
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });
    const result = await synthesizeDaily(collection, [], {
      invoke: async () => JSON.stringify([
        { title: 'First', summary: 'The first three saved items.', itemIds: ['i1', 'i2', 'i3'], relatedIds: [], projects: [] },
        ...Array.from({ length: 6 }, (_, index) => ({
          title: `Theme ${index + 2}`,
          summary: `Saved item ${index + 4}.`,
          itemIds: [`i${index + 4}`],
          relatedIds: [],
          projects: [],
        })),
      ]),
    });

    assert.equal(result.themedCount, 9);
    assert.equal(result.alsoSavedCount, 2);
    const digest = await readFileText(result.digestPath);
    const alsoSaved = digest.split('## Also saved\n\n')[1];
    assert.ok(alsoSaved);
    for (const item of collection.items.slice(9)) {
      assert.ok(alsoSaved.includes(item.canonicalUrl ?? item.id));
    }
  });
});

test('daily: synthesize renders items from themes dropped by the cap under Also saved', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, Array.from({ length: 9 }, (_, index) => starRecord({
      id: index + 1,
      fullName: `overflow/item-${index + 1}`,
      starredAt: '2026-07-06T12:00:00.000Z',
    })));
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });
    const result = await synthesizeDaily(collection, [], {
      invoke: async () => JSON.stringify(Array.from({ length: 9 }, (_, index) => ({
        title: `Theme ${index + 1}`,
        summary: `Saved item ${index + 1}.`,
        itemIds: [`i${index + 1}`],
        relatedIds: [],
        projects: [],
      }))),
    });

    assert.equal(result.themedCount, 7);
    assert.equal(result.alsoSavedCount, 2);
    const digest = await readFileText(result.digestPath);
    const alsoSaved = digest.split('## Also saved\n\n')[1];
    assert.ok(alsoSaved);
    for (const item of collection.items.slice(7)) {
      assert.ok(alsoSaved.includes(item.canonicalUrl ?? item.id));
    }
  });
});

test('daily: thin bare links are excluded from synthesis and reconciled into Also saved', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'eligible/in-prompt', starredAt: '2026-07-06T12:00:00.000Z' }),
      starRecord({ id: 2, fullName: 'thin/otherwise-ignored', starredAt: '2026-07-06T13:00:00.000Z' }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });
    const item = collection.items.find((candidate) => candidate.canonicalUrl?.includes('thin/otherwise-ignored'))!;
    item.displayTitle = 'Distinctive thin link title';
    item.searchText = 'https://example.com/a/very/long/path/that/is/still/only/a/link a few words';
    assert.ok(contentLength(item.searchText) < 120);
    const connected = await connectDailyItems(collection);
    let prompt = '';
    const result = await synthesizeDaily(collection, connected, {
      invoke: async (value) => {
        prompt = value;
        return JSON.stringify([{ title: 'Eligible', summary: 'The substantive item.', itemIds: ['i1'], relatedIds: [], projects: [] }]);
      },
    });

    assert.equal(result.thinSkipped, 1);
    assert.equal(result.themedCount + result.alsoSavedCount, collection.items.length);
    assert.match(prompt, /id=i1 source=github-stars title="eligible\/in-prompt"/);
    assert.ok(!prompt.includes('Distinctive thin link title'));
    const digest = await readFileText(result.digestPath);
    assert.match(digest, /## Also saved/);
    assert.match(digest, /Distinctive thin link title/);
    assert.match(digest, /thin_skipped: 1/);
    assert.match(digest, /thin links skipped from synthesis 1/);
  });
});

test('daily: URL plus substantial commentary remains eligible for synthesis', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [starRecord({ id: 1, fullName: 'commentary/eligible', starredAt: '2026-07-06T12:00:00.000Z' })]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });
    collection.items[0].displayTitle = 'Distinctive commentary title';
    collection.items[0].searchText = `https://example.com/article ${'useful commentary '.repeat(10)}`;
    assert.ok(contentLength(collection.items[0].searchText) >= 120);
    let prompt = '';
    const result = await synthesizeDaily(collection, [], {
      invoke: async (value) => {
        prompt = value;
        return JSON.stringify([{ title: 'Commentary', summary: 'Substantial saved commentary.', itemIds: ['i1'], relatedIds: [], projects: [] }]);
      },
    });

    assert.equal(result.thinSkipped, 0);
    assert.ok(prompt.includes('i1'));
  });
});

test('daily: skips the LLM when every item is thin', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'thin/one', starredAt: '2026-07-06T12:00:00.000Z' }),
      starRecord({ id: 2, fullName: 'thin/two', starredAt: '2026-07-06T13:00:00.000Z' }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });
    for (const item of collection.items) item.searchText = `${item.canonicalUrl} brief share`;
    let invoked = false;
    const result = await synthesizeDaily(collection, [], { invoke: async () => { invoked = true; return '[]'; } });

    assert.equal(invoked, false);
    assert.equal(result.usedLlm, false);
    assert.equal(result.themes.length, 0);
    assert.equal(result.thinSkipped, 2);
    assert.equal(result.alsoSavedCount, 2);
  });
});

test('daily: enriches a thin link into the prompt and reuses its durable cache', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [starRecord({ id: 75, fullName: 'a/enriched-link', starredAt: '2026-07-06T12:00:00.000Z', description: 'brief' })]);
    await rebuildCanonicalIndex();
    const collection = await collectDaily({ date: '2026-07-06' });
    const item = collection.items[0];
    item.searchText = `${item.canonicalUrl} brief`;
    let fetchCalls = 0;
    const enrichment = await enrichThinItems(collection.items, {
      fetch: async () => {
        fetchCalls += 1;
        return new Response('<html><title>Enriched page</title><meta name="description" content="A useful page."><body>Detailed article material for the digest.</body></html>');
      },
      llm: async () => 'This page explains a useful implementation technique with practical context.',
    });
    mergeEnrichmentSummaries(collection.items, enrichment.summaries);
    assert.equal(enrichment.enrichedCount, 1);
    assert.match(item.searchText, /summary: This page explains/);
    let prompt = '';
    const result = await synthesizeDaily(collection, await connectDailyItems(collection), {
      enrichedCount: enrichment.enrichedCount,
      enrichedItemIds: [item.id],
      invoke: async (value) => {
        prompt = value;
        return '[{"title":"Useful technique","summary":"A connected implementation idea.","itemIds":["i1"],"relatedIds":[],"projects":[]}]';
      },
    });
    assert.equal(result.usedLlm, true);
    assert.match(prompt, /enriched-link/);
    assert.equal(fetchCalls, 1);

    await rebuildCanonicalIndex();
    const cached = await enrichThinItems(collection.items, {
      fetch: async () => { throw new Error('cache miss'); },
      llm: async () => { throw new Error('cache miss'); },
    });
    assert.equal(cached.enrichedCount, 1);
  });
});

test('daily: enrichment backfill reports pending rows, enriches through seams, and skips cached rows on rerun', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [starRecord({ id: 77, fullName: 'a/backfill-link', starredAt: '2026-07-06T12:00:00.000Z', description: 'brief' })]);
    await rebuildCanonicalIndex();
    const db = await openDb(twitterBookmarksIndexPath());
    try {
      db.run('UPDATE canonical_bookmarks SET search_text = canonical_url || \' brief\'');
      saveDb(db, twitterBookmarksIndexPath());
    } finally {
      db.close();
    }

    const dryRun = await enrichBackfill({ dryRun: true });
    assert.deepEqual(dryRun, { eligible: 1, pending: 1, attempted: 0, ok: 0, failed: 0, skippedCached: 0, errorKinds: [] });
    let fetchCalls = 0;
    const first = await enrichBackfill({
      fetch: async () => { fetchCalls += 1; return new Response('<title>Backfill</title><body>Useful source material</body>'); },
      llm: async () => 'A durable summary-only search term.',
    });
    assert.equal(first.attempted, 1);
    assert.equal(first.ok, 1);
    assert.equal(fetchCalls, 1);

    const rerun = await enrichBackfill({
      fetch: async () => { throw new Error('cached row must not fetch'); },
      llm: async () => { throw new Error('cached row must not summarize'); },
    });
    assert.deepEqual(rerun, { eligible: 1, pending: 0, attempted: 0, ok: 0, failed: 0, skippedCached: 1, errorKinds: [] });
  });
});

test('daily: empty enrichment completion is cached as failed and leaves the item thin', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [starRecord({ id: 76, fullName: 'a/empty-enrichment', starredAt: '2026-07-06T12:00:00.000Z', description: 'brief' })]);
    await rebuildCanonicalIndex();
    const collection = await collectDaily({ date: '2026-07-06' });
    collection.items[0].searchText = `${collection.items[0].canonicalUrl} brief`;
    const enrichment = await enrichThinItems(collection.items, {
      fetch: async () => new Response('<title>Page</title><body>body</body>'),
      llm: async () => '',
    });
    mergeEnrichmentSummaries(collection.items, enrichment.summaries);
    assert.equal(enrichment.enrichedCount, 0);
    assert.ok(contentLength(collection.items[0].searchText) < 120);
    const result = await synthesizeDaily(collection, [], { invoke: async () => { throw new Error('should not invoke'); } });
    assert.equal(result.thinSkipped, 1);
    assert.match(await readFileText(result.digestPath), /Also saved/);
  });
});

test('daily: enrichment excludes X articles, YouTube, and PDFs', () => {
  const item = (url: string): CanonicalRecentItem => ({ id: url, canonicalUrl: url, displayTitle: url, searchText: url, sources: [], firstSavedAt: null, lastSavedAt: null, primaryCategory: null, primaryDomain: null });
  assert.equal(isEnrichmentEligible(item('https://x.com/i/article/123')), false);
  assert.equal(isEnrichmentEligible(item('https://www.youtube.com/watch?v=abc')), false);
  assert.equal(isEnrichmentEligible(item('https://example.com/report.pdf')), false);
});

test('daily: retries a transient 429 fetch and records failure errors without retrying 404s', async () => {
  await withIsolatedDataDir(async () => {
    const item: CanonicalRecentItem = { id: 'retry', canonicalUrl: 'https://example.com/retry', displayTitle: 'retry', searchText: 'https://example.com/retry', sources: [], firstSavedAt: null, lastSavedAt: null, primaryCategory: null, primaryDomain: null };
    let calls = 0;
    const recovered = await enrichThinItems([item], {
      fetch: async () => ++calls === 1 ? new Response('', { status: 429 }) : new Response('<title>Recovered</title><body>source</body>'),
      llm: async () => 'Recovered after a transient failure.',
    });
    assert.equal(recovered.enrichedCount, 1);
    assert.equal(calls, 2);

    const failed: CanonicalRecentItem = { ...item, id: 'no-retry', canonicalUrl: 'https://example.com/no-retry', searchText: 'https://example.com/no-retry' };
    calls = 0;
    await enrichThinItems([failed], { fetch: async () => { calls += 1; return new Response('', { status: 404 }); }, llm: async () => 'unused' });
    assert.equal(calls, 1);
    const db = await openDb(twitterBookmarksIndexPath());
    try {
      const row = db.exec(`SELECT error FROM link_enrichment WHERE url = ?`, [failed.canonicalUrl])[0]?.values[0]?.[0];
      assert.match(String(row), /^fetch: HTTP 404/);
    } finally { db.close(); }
  });
});

test('daily: retry-failed immediately re-attempts transient cached failures', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [starRecord({ id: 78, fullName: 'a/retry-failed', starredAt: '2026-07-06T12:00:00.000Z', description: 'brief' })]);
    await rebuildCanonicalIndex();
    const db = await openDb(twitterBookmarksIndexPath());
    try { db.run(`UPDATE canonical_bookmarks SET search_text = canonical_url || ' brief'`); saveDb(db, twitterBookmarksIndexPath()); } finally { db.close(); }
    await enrichBackfill({ fetch: async () => new Response('', { status: 429 }), llm: async () => 'unused' });
    let calls = 0;
    const result = await enrichBackfill({ retryFailed: true, fetch: async () => { calls += 1; return new Response('<title>OK</title><body>source</body>'); }, llm: async () => 'Recovered.' });
    assert.equal(result.ok, 1);
    assert.equal(calls, 1);
  });
});

test('daily: enrichment silently no-ops without an OpenCode key', async () => {
  const previousGo = process.env.OPENCODE_GO_API_KEY;
  const previousApi = process.env.OPENCODE_API_KEY;
  delete process.env.OPENCODE_GO_API_KEY;
  delete process.env.OPENCODE_API_KEY;
  try {
    const result = await enrichThinItems([{ id: 'thin', canonicalUrl: 'https://example.com/thin', displayTitle: 'thin', searchText: 'https://example.com/thin', sources: [], firstSavedAt: null, lastSavedAt: null, primaryCategory: null, primaryDomain: null }]);
    assert.equal(result.enrichedCount, 0);
  } finally {
    if (previousGo === undefined) delete process.env.OPENCODE_GO_API_KEY;
    else process.env.OPENCODE_GO_API_KEY = previousGo;
    if (previousApi === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = previousApi;
  }
});

test('daily: enrichment never fetches private IPs or redirects to them', async () => {
  await withIsolatedDataDir(async () => {
    const thin = (url: string): CanonicalRecentItem => ({ id: url, canonicalUrl: url, displayTitle: url, searchText: url, sources: [], firstSavedAt: null, lastSavedAt: null, primaryCategory: null, primaryDomain: null });
    let fetchCalls = 0;
    const privateResult = await enrichThinItems([thin('http://192.168.1.1/x')], {
      fetch: async () => { fetchCalls += 1; throw new Error('must not fetch'); },
      llm: async () => 'unused',
    });
    assert.equal(privateResult.enrichedCount, 0);
    assert.equal(fetchCalls, 0);

    const redirectResult = await enrichThinItems([thin('https://example.com/redirect')], {
      fetch: async () => {
        fetchCalls += 1;
        return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/internal' } });
      },
      llm: async () => 'unused',
    });
    assert.equal(redirectResult.enrichedCount, 0);
    assert.equal(fetchCalls, 1);
  });
});

test('daily: an OpenCode timeout records a failed enrichment without hanging', async () => {
  await withIsolatedDataDir(async () => {
    const item: CanonicalRecentItem = { id: 'timeout', canonicalUrl: 'https://example.com/timeout', displayTitle: 'timeout', searchText: 'https://example.com/timeout', sources: [], firstSavedAt: null, lastSavedAt: null, primaryCategory: null, primaryDomain: null };
    const { createOpenCodeClient } = await import('../src/llm/opencode-client.js');
    const client = createOpenCodeClient({ apiKey: 'test-key', timeoutMs: 5, fetch: async () => new Promise<Response>(() => {}) });
    const result = await enrichThinItems([item], {
      fetch: async () => new Response('<title>Page</title><body>body</body>'),
      llm: async (prompt) => (await client.chat({ prompt })).text,
    });
    assert.equal(result.enrichedCount, 0);

    let retried = false;
    const cachedFailure = await enrichThinItems([item], {
      fetch: async () => { retried = true; throw new Error('should remain cached failed'); },
      llm: async () => { retried = true; return 'should not run'; },
    });
    assert.equal(cachedFailure.enrichedCount, 0);
    assert.equal(retried, false);
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

test('daily: external notes with valid https URLs render; invalid URLs drop', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/agent-runner', starredAt: '2026-07-06T12:00:00.000Z', description: 'agent runner harness with detailed notes on orchestration, evaluation, implementation choices, failure recovery, and practical usage patterns for teams. '.repeat(2) }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ now: new Date('2026-07-07T00:00:00.000Z') });
    const connected = await connectDailyItems(collection);

    const fakeResponse = JSON.stringify([
      {
        title: 'Agent harnesses',
        summary: 'New runner harness saved.',
        itemIds: ['i1'],
        relatedIds: [],
        projects: [],
        externalNotes: [
          { claim: 'OpenAI published agent eval guidance', sourceUrl: 'https://openai.com/index/agents', sourceLabel: 'OpenAI', aboutIds: ['i1'] },
          { claim: 'fabricated note without url', sourceUrl: 'not-a-url', aboutIds: [] },
          { claim: 'missing claim url only', sourceUrl: '', aboutIds: [] },
        ],
      },
    ]);

    const result = await synthesizeDaily(collection, connected, {
      invoke: async () => fakeResponse,
      groundExternal: true,
    });
    assert.equal(result.themes.length, 1);
    assert.equal(result.themes[0].externalNotes.length, 1);
    assert.equal(result.themes[0].externalNotes[0].sourceUrl, 'https://openai.com/index/agents');
    assert.ok(result.droppedCitations >= 2);

    const digest = await readFileText(result.digestPath);
    assert.match(digest, /Additional context \(web\/X\)/);
    assert.match(digest, /OpenAI published agent eval guidance/);
    assert.match(digest, /openai\.com\/index\/agents/);
    assert.ok(!digest.includes('fabricated note'));
  });
});

test('daily: buildDailyPrompt includes externalNotes schema only when grounding is enabled', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/solo', starredAt: '2026-07-06T12:00:00.000Z', description: 'standalone tool with detailed commentary about architecture, deployment tradeoffs, operational considerations, and practical implementation guidance. '.repeat(2) }),
    ]);
    await rebuildCanonicalIndex();
    const collection = await collectDaily({ date: '2026-07-06' });
    const connected = await connectDailyItems(collection);
    const aliases = buildDailyAliases(collection, connected);

    const plain = buildDailyPrompt(collection, connected, aliases);
    assert.ok(!plain.includes('externalNotes'));
    assert.match(plain, /Do not add external web claims/);

    const grounded = buildDailyPrompt(collection, connected, aliases, { groundExternal: true });
    assert.match(grounded, /externalNotes/);
    assert.match(grounded, /web and X search/);
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
