import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { browserBookmarksCachePath, browserBookmarksMetaPath, canonicalCommandsDir, canonicalDataDir, canonicalLibraryDir, dataDir, libraryDir, mdDir, commandsDir, mdSchemaPath, youtubeLibraryIndexHtmlPath, youtubeNotePath, youtubeSlidesDir } from '../src/paths.js';

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) {
    previous[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('paths: env overrides split data, library, and commands roots', () => {
  withEnv({
    FT_DATA_DIR: '/tmp/ft-data',
    FT_LIBRARY_DIR: '/tmp/ft-library',
    FT_COMMANDS_DIR: '/tmp/ft-commands',
  }, () => {
    assert.equal(dataDir(), '/tmp/ft-data');
    assert.equal(libraryDir(), '/tmp/ft-library');
    assert.equal(mdDir(), '/tmp/ft-library');
    assert.equal(commandsDir(), '/tmp/ft-commands');
    assert.equal(canonicalDataDir(), '/tmp/ft-data');
    assert.equal(canonicalLibraryDir(), '/tmp/ft-library');
    assert.equal(canonicalCommandsDir(), '/tmp/ft-commands');
    assert.equal(mdSchemaPath(), path.join('/tmp/ft-library', 'schema.md'));
  });
});

test('paths: FT_DATA_DIR keeps the legacy md child unless FT_LIBRARY_DIR is set', () => {
  withEnv({
    FT_DATA_DIR: '/tmp/ft-data',
    FT_LIBRARY_DIR: undefined,
    FT_COMMANDS_DIR: undefined,
  }, () => {
    assert.equal(dataDir(), '/tmp/ft-data');
    assert.equal(libraryDir(), '/tmp/ft-data/md');
    assert.equal(mdDir(), '/tmp/ft-data/md');
  });
});

test('paths: browser bookmark cache paths are scoped under FT_DATA_DIR browsers root', () => {
  withEnv({
    FT_DATA_DIR: '/tmp/ft-data',
  }, () => {
    assert.equal(
      browserBookmarksCachePath('chrome', 'Default'),
      path.join('/tmp/ft-data', 'browsers', 'chrome', 'Default', 'bookmarks.jsonl'),
    );
    assert.equal(
      browserBookmarksMetaPath('safari', 'default'),
      path.join('/tmp/ft-data', 'browsers', 'safari', 'default', 'meta.json'),
    );
  });
});

test('paths: browser bookmark cache paths reject traversal segments', () => {
  assert.throws(
    () => browserBookmarksCachePath('../chrome', 'Default'),
    /Invalid browser bookmark browser/,
  );
  assert.throws(
    () => browserBookmarksMetaPath('chrome', '../Default'),
    /Invalid browser bookmark profile/,
  );
  assert.throws(
    () => browserBookmarksCachePath('/tmp/chrome', 'Default'),
    /Invalid browser bookmark browser/,
  );
});

test('paths: youtube notes are grouped by publish month and keep existing paths stable', () => {
  withEnv({ FT_LIBRARY_DIR: '/tmp/ft-library', FT_DATA_DIR: '/tmp/ft-data' }, () => {
    assert.equal(youtubeLibraryIndexHtmlPath(), path.join('/tmp/ft-library', 'youtube', 'index.html'));
    assert.equal(youtubeNotePath('abc123', '20260512'), path.join('/tmp/ft-library', 'youtube', '2026-05', 'abc123.md'));
    assert.equal(youtubeNotePath('abc123', '2026-05-12T00:00:00.000Z'), path.join('/tmp/ft-library', 'youtube', '2026-05', 'abc123.md'));
    assert.equal(youtubeNotePath('abc123', undefined), path.join('/tmp/ft-library', 'youtube', 'undated', 'abc123.md'));
    assert.equal(youtubeNotePath('abc123', '20260512', '/tmp/existing/abc123.md'), '/tmp/existing/abc123.md');
    assert.equal(youtubeSlidesDir('abc123'), path.join('/tmp/ft-data', 'youtube', 'artifacts', 'abc123', 'slides'));
  });
});

test('paths: youtube note and slide paths reject unsafe video ids', () => {
  assert.throws(() => youtubeNotePath('../abc', '20260512'), /Invalid youtube video id/);
  assert.throws(() => youtubeSlidesDir('/tmp/abc'), /Invalid youtube video id/);
});

test('paths: default command root is under ~/.fieldtheory', () => {
  withEnv({
    FT_COMMANDS_DIR: undefined,
  }, () => {
    assert.equal(commandsDir(), path.join(os.homedir(), '.fieldtheory', 'commands'));
  });
});
