import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises';
import {
  countLibraryDocs,
  getLibraryDocById,
  getLibraryIndexStats,
  reindexLibraryDocs,
  searchLibraryDocs,
} from '../src/library-index-db.js';

interface Env {
  root: string;
  library: string;
  commands: string;
}

async function withLibrary<T>(fn: (env: Env) => Promise<T>): Promise<T> {
  const previous = {
    data: process.env.FT_DATA_DIR,
    library: process.env.FT_LIBRARY_DIR,
    commands: process.env.FT_COMMANDS_DIR,
  };
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-library-index-'));
  const library = path.join(root, 'library');
  const commands = path.join(root, 'commands');
  await mkdir(library, { recursive: true });
  await mkdir(commands, { recursive: true });
  process.env.FT_DATA_DIR = root;
  process.env.FT_LIBRARY_DIR = library;
  process.env.FT_COMMANDS_DIR = commands;
  try {
    return await fn({ root, library, commands });
  } finally {
    for (const [key, value] of [['FT_DATA_DIR', previous.data], ['FT_LIBRARY_DIR', previous.library], ['FT_COMMANDS_DIR', previous.commands]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function writeDoc(root: string, relPath: string, content: string): Promise<string> {
  const absPath = path.join(root, relPath);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, content);
  return absPath;
}

test('reindexLibraryDocs indexes library and command markdown, skipping bookmark exports', async () => {
  await withLibrary(async ({ library, commands }) => {
    await writeDoc(library, 'youtube/2026-06/abc.md', '# Attention explained\n\nTransformer attention is a weighted sum.\n');
    await writeDoc(library, 'daily/2026-06-01.md', '# Daily digest\n\ntags: []\n');
    await writeDoc(library, 'bookmarks/b1.md', '# Bookmark export\n\nAttention duplicate row.\n');
    await writeDoc(library, 'notes.txt', 'not markdown');
    await writeDoc(commands, 'review.md', '# Review command\n\nRun a review.\n');

    const first = await reindexLibraryDocs();
    assert.equal(first.added, 3);
    assert.equal(first.updated, 0);
    assert.equal(first.removed, 0);
    assert.equal(first.total, 3);

    const places = (await searchLibraryDocs({ limit: 10 })).map((doc) => doc.id).sort();
    assert.deepEqual(places, ['commands:review.md', 'library:daily/2026-06-01.md', 'library:youtube/2026-06/abc.md']);
  });
});

test('reindexLibraryDocs is incremental across changes and deletions', async () => {
  await withLibrary(async ({ library }) => {
    const target = await writeDoc(library, 'concepts/one.md', '# One\n\nFirst body.\n');
    await writeDoc(library, 'concepts/two.md', '# Two\n\nSecond body.\n');
    await reindexLibraryDocs();

    const unchanged = await reindexLibraryDocs();
    assert.deepEqual(
      { added: unchanged.added, updated: unchanged.updated, removed: unchanged.removed },
      { added: 0, updated: 0, removed: 0 },
    );

    await writeFile(target, '# One\n\nRewritten body about retrieval.\n');
    const changed = await reindexLibraryDocs();
    assert.equal(changed.updated, 1);
    assert.equal(changed.added, 0);
    const hits = await searchLibraryDocs({ query: 'retrieval' });
    assert.deepEqual(hits.map((doc) => doc.relPath), ['concepts/one.md']);

    await rm(path.join(library, 'concepts/two.md'));
    const removed = await reindexLibraryDocs();
    assert.equal(removed.removed, 1);
    assert.equal(removed.total, 1);
  });
});

test('searchLibraryDocs ranks title matches above body matches and filters by section and place', async () => {
  await withLibrary(async ({ library, commands }) => {
    await writeDoc(library, 'concepts/embeddings.md', '# Embeddings\n\nA dense vector representation.\n');
    await writeDoc(library, 'youtube/2026-06/talk.md', '# A talk\n\nThe speaker mentions embeddings once.\n');
    await writeDoc(commands, 'embed.md', '# Embed command\n\nEmbeddings pipeline runner.\n');
    await reindexLibraryDocs();

    const ranked = await searchLibraryDocs({ query: 'embeddings', limit: 10 });
    assert.equal(ranked[0].relPath, 'concepts/embeddings.md');
    assert.equal(ranked.length, 3);

    const sectioned = await searchLibraryDocs({ query: 'embeddings', section: 'youtube' });
    assert.deepEqual(sectioned.map((doc) => doc.relPath), ['youtube/2026-06/talk.md']);

    const commandsOnly = await searchLibraryDocs({ query: 'embeddings', place: 'commands' });
    assert.deepEqual(commandsOnly.map((doc) => doc.relPath), ['embed.md']);
    assert.equal(await countLibraryDocs({ query: 'embeddings' }), 3);
    assert.equal(await countLibraryDocs({ place: 'commands' }), 1);
  });
});

test('searchLibraryDocs tolerates punctuation in the query', async () => {
  await withLibrary(async ({ library }) => {
    await writeDoc(library, 'concepts/agents.md', '# Agents\n\nWhat makes an agent harness good?\n');
    await reindexLibraryDocs();
    const hits = await searchLibraryDocs({ query: 'What makes an agent harness good?' });
    assert.deepEqual(hits.map((doc) => doc.relPath), ['concepts/agents.md']);
  });
});

test('searchLibraryDocs without a query returns newest documents first', async () => {
  await withLibrary(async ({ library }) => {
    const older = await writeDoc(library, 'concepts/old.md', '# Old\n\nOlder note.\n');
    await writeDoc(library, 'concepts/new.md', '# New\n\nNewer note.\n');
    const past = new Date('2020-01-01T00:00:00.000Z');
    await utimes(older, past, past);
    await reindexLibraryDocs();

    const recent = await searchLibraryDocs({ limit: 2 });
    assert.deepEqual(recent.map((doc) => doc.relPath), ['concepts/new.md', 'concepts/old.md']);
    assert.ok(recent[0].snippet.includes('Newer note'));
  });
});

test('getLibraryIndexStats reports per-section counts and getLibraryDocById returns the body', async () => {
  await withLibrary(async ({ library }) => {
    const empty = await getLibraryIndexStats();
    assert.deepEqual(empty, { total: 0, sections: [], lastUpdatedAt: null, indexed: false });

    await writeDoc(library, 'youtube/2026-06/a.md', '# A\n\n#ml notes\n');
    await writeDoc(library, 'youtube/2026-06/b.md', '# B\n\nmore notes\n');
    await writeDoc(library, 'README.md', '# Root page\n\nroot body\n');
    await reindexLibraryDocs();

    const stats = await getLibraryIndexStats();
    assert.equal(stats.total, 3);
    assert.equal(stats.indexed, true);
    assert.deepEqual(stats.sections, [
      { section: 'youtube', count: 2 },
      { section: '(root)', count: 1 },
    ]);

    const doc = await getLibraryDocById('library:youtube/2026-06/a.md');
    assert.equal(doc?.title, 'A');
    assert.deepEqual(doc?.tags, ['ml']);
    assert.ok(doc?.body.includes('#ml notes'));
    assert.equal(await getLibraryDocById('library:missing.md'), null);
  });
});
