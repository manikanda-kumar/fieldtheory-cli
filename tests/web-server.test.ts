import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { parseBoundedInteger, safeRoutePath } from '../src/web/http.js';
import { loadWebMediaIndex, resolveMediaFile } from '../src/web/media.js';
import { buildIndex } from '../src/bookmarks-db.js';
import { rebuildCanonicalIndex, upsertYoutubeVideosAsSources } from '../src/canonical-bookmarks-db.js';
import { openDb, saveDb } from '../src/db.js';
import { writeJsonLines } from '../src/fs.js';
import type { GitHubStarRecord } from '../src/github-stars/types.js';
import { twitterBookmarksIndexPath, xListsDir } from '../src/paths.js';
import { createBookmarkWebServer, type WebServerDeps } from '../src/web/server.js';
import { parseAskRequest, resetAskInFlightForTest } from '../src/web/ask.js';
import { resetLibraryIndexFreshnessForTest } from '../src/library-index-db.js';
import { HttpError } from '../src/web/http.js';
import { renderAppShell, appCss, appJs } from '../src/web/app-shell.js';

test('parseBoundedInteger clamps defaults and rejects invalid values', () => {
  assert.equal(parseBoundedInteger(null, { defaultValue: 30, min: 1, max: 100 }), 30);
  assert.equal(parseBoundedInteger('5', { defaultValue: 30, min: 1, max: 100 }), 5);
  assert.equal(parseBoundedInteger('500', { defaultValue: 30, min: 1, max: 100 }), 100);
  assert.throws(() => parseBoundedInteger('abc', { defaultValue: 30, min: 1, max: 100 }), /Invalid integer/);
  assert.throws(() => parseBoundedInteger('-1', { defaultValue: 30, min: 0, max: 100 }), /Invalid integer/);
});

test('safeRoutePath normalizes URL paths without query strings', () => {
  assert.equal(safeRoutePath('/api/bookmarks?limit=5'), '/api/bookmarks');
  assert.equal(safeRoutePath('/media/a%20b.jpg'), '/media/a b.jpg');
  assert.equal(safeRoutePath('not a url'), '/not a url');
});

test('loadWebMediaIndex exposes media URLs without absolute local paths', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-web-media-'));
  const mediaDir = path.join(root, 'bookmarks', 'media');
  await mkdir(mediaDir, { recursive: true });
  const localPath = path.join(mediaDir, 'one.jpg');
  await writeFile(localPath, 'image');
  const manifestPath = path.join(root, 'bookmarks', 'media-manifest.json');
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: '2026-06-24T00:00:00.000Z',
    limit: 1,
    maxBytes: 100,
    processed: 1,
    downloaded: 1,
    skippedTooLarge: 0,
    failed: 0,
    entries: [{
      bookmarkId: 'b1',
      tweetId: 't1',
      tweetUrl: 'https://x.com/a/status/t1',
      sourceUrl: 'https://example.com/one.jpg',
      localPath,
      contentType: 'image/jpeg',
      bytes: 5,
      status: 'downloaded',
      fetchedAt: '2026-06-24T00:00:00.000Z',
    }],
  }));

  const index = await loadWebMediaIndex({ mediaDir, manifestPath });
  assert.deepEqual(index.assetsByBookmarkId.get('b1'), [{
    url: '/media/one.jpg',
    sourceUrl: 'https://example.com/one.jpg',
    contentType: 'image/jpeg',
    bytes: 5,
  }]);
});

test('resolveMediaFile rejects traversal and unknown files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-web-media-'));
  const mediaDir = path.join(root, 'media');
  await mkdir(mediaDir, { recursive: true });
  const localPath = path.join(mediaDir, 'one.jpg');
  await writeFile(localPath, 'image');
  const index = await loadWebMediaIndex({
    mediaDir,
    manifestPath: path.join(root, 'missing-manifest.json'),
  });
  index.filesByName.set('one.jpg', { path: localPath, contentType: 'image/jpeg' });

  assert.equal(resolveMediaFile(index, 'one.jpg')?.path, localPath);
  assert.throws(() => resolveMediaFile(index, '../one.jpg'), /Invalid media path/);
  assert.equal(resolveMediaFile(index, 'missing.jpg'), null);
});

async function withTempFieldTheoryData<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const previous = process.env.FT_DATA_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-web-data-'));
  process.env.FT_DATA_DIR = root;
  try {
    return await fn(root);
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
  }
}

async function seedBookmarks(root: string): Promise<void> {
  await writeFile(path.join(root, 'bookmarks.jsonl'), `${JSON.stringify({
    id: 'b1',
    tweetId: '100',
    url: 'https://x.com/alice/status/100',
    text: 'Machine learning systems note',
    authorHandle: 'alice',
    authorName: 'Alice',
    postedAt: '2026-06-20T00:00:00.000Z',
    bookmarkedAt: '2026-06-21T00:00:00.000Z',
    syncedAt: '2026-06-21T00:00:00.000Z',
    links: ['https://example.com/article'],
    folderIds: ['f1'],
    folderNames: ['Research'],
    tags: [],
    ingestedVia: 'graphql',
  })}\n`);
  await buildIndex();

  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  try {
    db.run(
      `UPDATE bookmarks SET categories = ?, primary_category = ?, domains = ?, primary_domain = ? WHERE id = ?`,
      [JSON.stringify(['AI']), 'AI', JSON.stringify(['ml']), 'ml', 'b1'],
    );
    saveDb(db, dbPath);
  } finally {
    db.close();
  }
}

function githubStarRecord(overrides: Partial<GitHubStarRecord> = {}): GitHubStarRecord {
  return {
    id: 123,
    fullName: 'example/tool',
    owner: 'example',
    name: 'tool',
    htmlUrl: 'https://github.com/example/tool',
    description: 'Agent memory command line tool',
    homepageUrl: 'https://example.com',
    language: 'TypeScript',
    topics: ['agents', 'memory'],
    stargazersCount: 12345,
    forksCount: 678,
    openIssuesCount: 12,
    isArchived: false,
    isFork: false,
    defaultBranch: 'main',
    pushedAt: '2026-05-20T10:00:00Z',
    updatedAt: '2026-05-25T09:00:00Z',
    starredAt: '2026-05-31T12:34:56Z',
    syncedAt: '2026-05-31T13:00:00Z',
    ...overrides,
  };
}

async function seedUnifiedSources(root: string): Promise<void> {
  await mkdir(path.join(root, 'github-stars'), { recursive: true });
  await writeJsonLines(path.join(root, 'github-stars', 'stars.jsonl'), [githubStarRecord()]);
  await rebuildCanonicalIndex();
}

async function startTestServer(deps: WebServerDeps = {}): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server = createBookmarkWebServer(deps);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('bookmark web API lists, filters, shows, and reports stats', async () => {
  await withTempFieldTheoryData(async () => {
    await seedBookmarks(process.env.FT_DATA_DIR!);
    const server = await startTestServer();
    try {
      const listResponse = await fetch(`${server.baseUrl}/api/bookmarks?query=machine&limit=1`);
      assert.equal(listResponse.status, 200);
      assert.equal(listResponse.headers.get('access-control-allow-origin'), null);
      const list = await listResponse.json() as { items: Array<{ id: string; mediaAssets: unknown[] }>; total: number };
      assert.equal(list.total, 1);
      assert.equal(list.items[0]?.id, 'b1');
      assert.deepEqual(list.items[0]?.mediaAssets, []);

      const showResponse = await fetch(`${server.baseUrl}/api/bookmarks/b1`);
      assert.equal(showResponse.status, 200);
      const show = await showResponse.json() as { id: string; text: string };
      assert.equal(show.id, 'b1');

      const statsResponse = await fetch(`${server.baseUrl}/api/stats`);
      assert.equal(statsResponse.status, 200);
      const stats = await statsResponse.json() as { stats: { total: number }; categories: Array<{ category: string; count: number }> };
      assert.equal(stats.stats.total, 1);
      assert.equal(stats.categories[0]?.category, 'AI');
    } finally {
      await server.close();
    }
  });
});

test('web API lists and shows unified library items with provenance', async () => {
  await withTempFieldTheoryData(async (root) => {
    await seedUnifiedSources(root);
    const server = await startTestServer();
    try {
      const listResponse = await fetch(`${server.baseUrl}/api/unified?query=agent&source=github-stars&limit=10`);
      assert.equal(listResponse.status, 200);
      const list = await listResponse.json() as { items: Array<{ id: string; title: string; sources: string[] }>; total: number };
      assert.equal(list.total, 1);
      assert.equal(list.items[0]?.title, 'example/tool');
      assert.deepEqual(list.items[0]?.sources, ['github-stars']);

      const showResponse = await fetch(`${server.baseUrl}/api/unified/${encodeURIComponent(list.items[0]!.id)}`);
      assert.equal(showResponse.status, 200);
      const show = await showResponse.json() as { item: { id: string; kind: string }; sources: Array<{ source: string; sourceUrl: string }> };
      assert.equal(show.item.id, list.items[0]!.id);
      assert.equal(show.item.kind, 'repo');
      assert.deepEqual(show.sources.map((source) => source.source), ['github-stars']);
      assert.equal(show.sources[0]?.sourceUrl, 'https://github.com/example/tool');
    } finally {
      await server.close();
    }
  });
});

test('web API exposes YouTube note path and metadata in unified provenance', async () => {
  await withTempFieldTheoryData(async () => {
    await upsertYoutubeVideosAsSources([{
      videoId: 'video-1',
      title: 'Context Engineering Talk',
      tldr: 'Talk summary.',
      topics: ['agents'],
      notePath: '/tmp/youtube/video-1.md',
      channel: 'AI Engineer',
      durationSec: 1800,
      chapters: [{ tSec: 0, label: 'Opening', summary: 'Context bridge overview.' }],
    }]);
    const server = await startTestServer();
    try {
      const listResponse = await fetch(`${server.baseUrl}/api/unified?query=context%20bridge&source=youtube&limit=10`);
      assert.equal(listResponse.status, 200);
      const list = await listResponse.json() as { items: Array<{ id: string; kind: string }> };
      assert.equal(list.items[0]?.kind, 'video');

      const showResponse = await fetch(`${server.baseUrl}/api/unified/${encodeURIComponent(list.items[0]!.id)}`);
      assert.equal(showResponse.status, 200);
      const show = await showResponse.json() as { sources: Array<{ source: string; contentPath: string | null; metadata: { channel?: string; durationSec?: number } | null }> };
      assert.equal(show.sources[0]?.source, 'youtube');
      assert.equal(show.sources[0]?.contentPath, '/tmp/youtube/video-1.md');
      assert.equal(show.sources[0]?.metadata?.channel, 'AI Engineer');
      assert.equal(show.sources[0]?.metadata?.durationSec, 1800);
    } finally {
      await server.close();
    }
  });
});

async function withTempLibrary<T>(fn: (library: string) => Promise<T>): Promise<T> {
  const previous = { library: process.env.FT_LIBRARY_DIR, commands: process.env.FT_COMMANDS_DIR };
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-web-library-'));
  const library = path.join(root, 'library');
  const commands = path.join(root, 'commands');
  await mkdir(library, { recursive: true });
  await mkdir(commands, { recursive: true });
  process.env.FT_LIBRARY_DIR = library;
  process.env.FT_COMMANDS_DIR = commands;
  resetLibraryIndexFreshnessForTest();
  try {
    return await fn(library);
  } finally {
    resetLibraryIndexFreshnessForTest();
    for (const [key, value] of [['FT_LIBRARY_DIR', previous.library], ['FT_COMMANDS_DIR', previous.commands]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('web API searches Library markdown as its own archive', async () => {
  await withTempFieldTheoryData(async () => {
    await withTempLibrary(async (library) => {
      await mkdir(path.join(library, 'concepts'), { recursive: true });
      await writeFile(path.join(library, 'concepts', 'retrieval.md'), '# Retrieval notes\n\n#search Hybrid retrieval beats keyword search.\n');
      const server = await startTestServer();
      try {
        const searchResponse = await fetch(`${server.baseUrl}/api/library-docs?query=retrieval&limit=5`);
        assert.equal(searchResponse.status, 200);
        const search = await searchResponse.json() as {
          items: Array<{ id: string; relPath: string; section: string; title: string; tags: string[]; snippet: string }>;
          total: number;
        };
        assert.equal(search.total, 1);
        assert.equal(search.items[0]?.relPath, 'concepts/retrieval.md');
        assert.equal(search.items[0]?.section, 'concepts');
        assert.deepEqual(search.items[0]?.tags, ['search']);

        const statsResponse = await fetch(`${server.baseUrl}/api/library-docs/stats`);
        assert.equal(statsResponse.status, 200);
        const stats = await statsResponse.json() as { total: number; indexed: boolean; sections: Array<{ section: string; count: number }> };
        assert.equal(stats.total, 1);
        assert.equal(stats.indexed, true);
        assert.deepEqual(stats.sections, [{ section: 'concepts', count: 1 }]);

        const docResponse = await fetch(`${server.baseUrl}/api/library-doc?id=${encodeURIComponent(search.items[0]!.id)}`);
        assert.equal(docResponse.status, 200);
        const doc = await docResponse.json() as { title: string; body: string };
        assert.equal(doc.title, 'Retrieval notes');
        assert.match(doc.body, /Hybrid retrieval/);

        assert.equal((await fetch(`${server.baseUrl}/api/library-docs?place=nope`)).status, 400);
        assert.equal((await fetch(`${server.baseUrl}/api/library-doc`)).status, 400);
        assert.equal((await fetch(`${server.baseUrl}/api/library-doc?id=library:missing.md`)).status, 404);
      } finally {
        await server.close();
      }
    });
  });
});

test('bookmark web API returns status errors for invalid requests', async () => {
  await withTempFieldTheoryData(async () => {
    await seedBookmarks(process.env.FT_DATA_DIR!);
    const server = await startTestServer();
    try {
      assert.equal((await fetch(`${server.baseUrl}/api/bookmarks?limit=abc`)).status, 400);
      assert.equal((await fetch(`${server.baseUrl}/api/bookmarks/missing`)).status, 404);
      assert.equal((await fetch(`${server.baseUrl}/api/nope`)).status, 404);
    } finally {
      await server.close();
    }
  });
});

test('app shell includes root element and static asset links', () => {
  const html = renderAppShell();
  assert.match(html, /<div id="app" class="site-shell ft-archive-shell">/);
  assert.match(html, /class="nav-link active"/);
  assert.match(appCss, /\.nav-link/);
  assert.match(appCss, /\.pill-context/);
  assert.match(appCss, /\.sidebar-hidden/);
  assert.match(html, /\/styles\.css/);
  assert.match(html, /\/app\.js/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  assert.match(html, /data-source="github-stars"/);
  assert.match(html, /data-lane="people"/);
  assert.match(html, /data-lane="synthesis"/);
  assert.match(appCss, /\.ft-archive-shell/);
  assert.match(appCss, /\.source-chip/);
  assert.match(appCss, /\.bookmark-card/);
  assert.match(appCss, /\.results-feed/);
  assert.match(appCss, /\.tweet-card/);
  assert.match(appCss, /\.link-preview/);
  assert.match(appJs, /renderMediaObjects/);
  assert.match(appJs, /fetchBookmarks/);
  assert.match(appJs, /renderPeopleLane/);
  assert.match(appJs, /renderSynthesisLane/);
  assert.match(appJs, /sourceHints/);
  const inlineScripts = html.match(/<script>[\s\S]*?<\/script>/g) ?? [];
  assert.equal(inlineScripts.length, 1);
  assert.match(inlineScripts[0]!, /ft-theme/);
  for (const lane of ['home', 'today', 'bookmarks', 'sources', 'people', 'synthesis']) {
    assert.match(html, new RegExp(`data-lane="${lane}"`));
  }
  assert.match(appJs, /renderTodayLane/);
  assert.match(appJs, /renderSourcesLane/);
});

test('web API validates link preview requests', async () => {
  await withTempFieldTheoryData(async () => {
    const server = await startTestServer();
    try {
      assert.equal((await fetch(`${server.baseUrl}/api/link-preview`)).status, 400);
      assert.equal((await fetch(`${server.baseUrl}/api/link-preview?url=not-a-url`)).status, 400);
    } finally {
      await server.close();
    }
  });
});

test('web API serves list-backed today digest surfaces', async () => {
  await withTempFieldTheoryData(async () => {
    const xListDir = xListsDir();
    await mkdir(xListDir, { recursive: true });
    await writeFile(path.join(xListDir, '197-latest.json'), JSON.stringify({
      listId: '197',
      fetchedAt: '2026-06-24T12:00:00.000Z',
      tweets: [{
        id: '1',
        timelineKind: 'list-tweet',
        url: 'https://x.com/alice/status/1',
        author: 'alice',
        authorName: 'Alice',
        postedAt: '2026-06-24T10:00:00.000Z',
        text: 'Agents paper https://arxiv.org/abs/1234.5678',
        links: ['https://arxiv.org/abs/1234.5678'],
        engagement: { likeCount: 10, repostCount: 4, replyCount: 2, quoteCount: 1, viewCount: 1000 },
      }],
      stats: { count: 1, fetchedCount: 1, timeFilteredCount: 0, quotedOriginalsDropped: 0, pagesFetched: 1, stopReason: 'no-cursor', sinceHours: 24 },
    }));

    const server = await startTestServer();
    try {
      const today = await fetch(`${server.baseUrl}/api/lists/197/today`);
      assert.equal(today.status, 200);
      assert.equal(((await today.json()) as { tweets: unknown[] }).tweets.length, 1);

      const analysis = await fetch(`${server.baseUrl}/api/lists/197/analysis`);
      assert.equal(analysis.status, 200);
      assert.equal(((await analysis.json()) as { totalTweets: number }).totalTweets, 1);

      const sources = await fetch(`${server.baseUrl}/api/lists/197/sources`);
      assert.equal(sources.status, 200);
      assert.equal(((await sources.json()) as { sources: unknown[] }).sources.length, 1);

      const context = await fetch(`${server.baseUrl}/api/lists/197/context`);
      assert.equal(context.status, 200);
      assert.match(await context.text(), /X List 197 Today Context/);
    } finally {
      await server.close();
    }
  });
});

async function readSseEvents(response: Response): Promise<Array<{ event: string; data: any }>> {
  const text = await response.text();
  return text
    .split('\n\n')
    .map((frame) => {
      const event = frame.match(/^event: (.*)$/m);
      const data = frame.match(/^data: (.*)$/m);
      return event && data ? { event: event[1]!, data: JSON.parse(data[1]!) } : null;
    })
    .filter((frame): frame is { event: string; data: any } => frame !== null);
}

test('parseAskRequest requires a bounded question and reads the save flag', () => {
  const parsed = parseAskRequest(new URL('http://127.0.0.1/api/ask?query=%20what%20did%20I%20save%20&save=1'));
  assert.deepEqual(parsed, { question: 'what did I save', save: true });
  assert.equal(parseAskRequest(new URL('http://127.0.0.1/api/ask?query=hi')).save, false);
  assert.throws(() => parseAskRequest(new URL('http://127.0.0.1/api/ask')), (error: unknown) =>
    error instanceof HttpError && error.statusCode === 400);
  assert.throws(() => parseAskRequest(new URL('http://127.0.0.1/api/ask?query=' + 'x'.repeat(2001))), (error: unknown) =>
    error instanceof HttpError && error.statusCode === 400);
});

test('ask API streams progress and the final answer over SSE', async () => {
  resetAskInFlightForTest();
  const calls: Array<{ question: string; save?: boolean; engine?: string }> = [];
  const server = await startTestServer({
    pickEngine: () => 'claude',
    ask: async (question, options) => {
      calls.push({ question, save: options.save, engine: options.profile?.engine });
      options.onProgress?.('Reading index...');
      options.onProgress?.('Invoking LLM...');
      return {
        answer: '## Answer\n- grounded in saved items',
        pagesRead: ['categories/ai.md'],
        wikiUpdates: ['[[agents]] needs a note'],
        engine: 'claude',
        savedAs: '/tmp/concepts/answer.md',
      };
    },
  });
  try {
    const response = await fetch(`${server.baseUrl}/api/ask?query=what%20about%20agents&save=1`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/);
    const events = await readSseEvents(response);
    assert.deepEqual(events.map((frame) => frame.event), ['progress', 'progress', 'progress', 'done']);
    assert.equal(events[1]?.data.message, 'Reading index...');
    assert.equal(events[3]?.data.answer, '## Answer\n- grounded in saved items');
    assert.deepEqual(events[3]?.data.pagesRead, ['categories/ai.md']);
    assert.deepEqual(calls, [{ question: 'what about agents', save: true, engine: 'claude' }]);
  } finally {
    await server.close();
  }
});

test('ask API reports failures as an error event and frees the single-flight latch', async () => {
  resetAskInFlightForTest();
  let attempts = 0;
  const server = await startTestServer({
    pickEngine: () => 'codex',
    ask: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('engine exited with code 1');
      return { answer: 'ok', pagesRead: [], wikiUpdates: [], engine: 'codex' };
    },
  });
  try {
    const failed = await readSseEvents(await fetch(`${server.baseUrl}/api/ask?query=first`));
    assert.deepEqual(failed.at(-1), { event: 'error', data: { error: 'engine exited with code 1' } });

    const recovered = await readSseEvents(await fetch(`${server.baseUrl}/api/ask?query=second`));
    assert.equal(recovered.at(-1)?.event, 'done');
    assert.equal(attempts, 2);
  } finally {
    await server.close();
  }
});

test('ask API rejects bad methods and missing engines', async () => {
  resetAskInFlightForTest();
  const server = await startTestServer({ pickEngine: () => undefined });
  try {
    const missingQuery = await fetch(`${server.baseUrl}/api/ask`);
    assert.equal(missingQuery.status, 400);

    const wrongMethod = await fetch(`${server.baseUrl}/api/ask?query=hi`, { method: 'POST' });
    assert.equal(wrongMethod.status, 405);

    const noEngine = await fetch(`${server.baseUrl}/api/ask?query=hi`);
    assert.equal(noEngine.status, 503);
    assert.match(((await noEngine.json()) as { error: string }).error, /No LLM engine/);
  } finally {
    await server.close();
  }
});

test('app shell ships the ask lane, streaming client, and answer styles', () => {
  const html = renderAppShell();
  assert.match(html, /data-lane="ask"/);
  assert.match(html, /data-action="ask"/);
  assert.match(appJs, /startAsk/);
  assert.match(appJs, /renderMarkdown/);
  assert.match(appJs, /\/api\/ask\?/);
  assert.match(appCss, /\.ask-input/);
  assert.match(appCss, /\.answer-md/);
});

test('app shell renders Library notes as their own result group', () => {
  assert.match(appJs, /fetchNotesPanel/);
  assert.match(appJs, /\/api\/library-docs\?/);
  assert.match(appJs, /\/api\/library-doc\?id=/);
  assert.match(appJs, /From your notes/);
  assert.match(appCss, /\.notes-panel/);
  assert.match(appCss, /\.note-path/);
});
