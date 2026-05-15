import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  youtubeArtifactsDir,
  youtubeDir,
  youtubeLibraryDir,
  youtubeStatePath,
} from '../src/paths.js';
import {
  loadYoutubeState,
  markVideo,
  saveYoutubeState,
  shouldProcess,
  updateYoutubeState,
  type YoutubeState,
} from '../src/youtube/state.js';

async function withTempEnv<T>(fn: (roots: { dataDir: string; libraryDir: string }) => Promise<T>): Promise<T> {
  const previous = {
    FT_DATA_DIR: process.env.FT_DATA_DIR,
    FT_LIBRARY_DIR: process.env.FT_LIBRARY_DIR,
  };
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-youtube-state-'));
  process.env.FT_DATA_DIR = path.join(tmp, 'data');
  process.env.FT_LIBRARY_DIR = path.join(tmp, 'library');

  try {
    return await fn({ dataDir: process.env.FT_DATA_DIR, libraryDir: process.env.FT_LIBRARY_DIR });
  } finally {
    if (previous.FT_DATA_DIR === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous.FT_DATA_DIR;
    if (previous.FT_LIBRARY_DIR === undefined) delete process.env.FT_LIBRARY_DIR;
    else process.env.FT_LIBRARY_DIR = previous.FT_LIBRARY_DIR;
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

test('youtube paths respect FT_DATA_DIR and FT_LIBRARY_DIR', async () => {
  await withTempEnv(async ({ dataDir, libraryDir }) => {
    assert.equal(youtubeDir(), path.join(dataDir, 'youtube'));
    assert.equal(youtubeStatePath(), path.join(dataDir, 'youtube', 'state.json'));
    assert.equal(youtubeArtifactsDir('abc123'), path.join(dataDir, 'youtube', 'artifacts', 'abc123'));
    assert.equal(youtubeLibraryDir(), path.join(libraryDir, 'youtube'));
  });
});

test('youtube artifact path rejects traversal segments', () => {
  assert.throws(() => youtubeArtifactsDir('../abc123'), /Invalid youtube video id/);
  assert.throws(() => youtubeArtifactsDir('/tmp/abc123'), /Invalid youtube video id/);
});

test('youtube state round-trips through load and save', async () => {
  await withTempEnv(async () => {
    const initial = await loadYoutubeState();
    assert.deepEqual(initial, { version: 1, playlists: {}, videos: {} });

    const state: YoutubeState = {
      version: 1,
      playlists: {
        PL1: { lastSyncedAt: '2026-05-12T00:00:00.000Z' },
      },
      videos: {
        v1: {
          status: 'done',
          contentHash: 'hash-1',
          title: 'Video One',
          channel: 'Example Channel',
          durationSec: 123,
          artifacts: { notesPath: '/tmp/v1.md' },
          updatedAt: '2026-05-12T00:01:00.000Z',
        },
      },
    };

    await saveYoutubeState(state);

    assert.deepEqual(await loadYoutubeState(), state);
  });
});

test('youtube state update reclaims stale lock from dead pid', async () => {
  await withTempEnv(async () => {
    await fs.mkdir(path.dirname(youtubeStatePath()), { recursive: true });
    await fs.writeFile(`${youtubeStatePath()}.lock`, '999999999\n2026-05-12T00:00:00.000Z\n', 'utf8');

    await updateYoutubeState((state) => {
      markVideo(state, 'v1', { status: 'done', artifacts: {} }, '2026-05-12T00:00:00.000Z');
    });

    assert.equal((await loadYoutubeState()).videos.v1.status, 'done');
    await assert.rejects(fs.stat(`${youtubeStatePath()}.lock`), /ENOENT/);
  });
});

test('youtube state rejects unsupported state versions', async () => {
  await withTempEnv(async () => {
    await fs.mkdir(path.dirname(youtubeStatePath()), { recursive: true });
    await fs.writeFile(youtubeStatePath(), JSON.stringify({ version: 2, playlists: {}, videos: {} }), 'utf8');

    await assert.rejects(loadYoutubeState(), /Unsupported YouTube state version: 2/);
  });
});

test('youtube state load normalizes missing artifact maps', async () => {
  await withTempEnv(async () => {
    await fs.mkdir(path.dirname(youtubeStatePath()), { recursive: true });
    await fs.writeFile(youtubeStatePath(), JSON.stringify({
      version: 1,
      playlists: {},
      videos: {
        v1: {
          status: 'done',
          contentHash: 'hash-1',
          updatedAt: '2026-05-12T00:00:00.000Z',
        },
      },
    }), 'utf8');

    assert.deepEqual((await loadYoutubeState()).videos.v1.artifacts, {});
  });
});

test('markVideo merges patches and refreshes updatedAt', async () => {
  const state: YoutubeState = { version: 1, playlists: {}, videos: {} };

  markVideo(state, 'v1', {
    status: 'done',
    contentHash: 'hash-1',
    title: 'First title',
    artifacts: { notesPath: '/tmp/old.md' },
  }, '2026-05-12T00:00:00.000Z');
  markVideo(state, 'v1', {
    title: 'Updated title',
    artifacts: { audioPath: '/tmp/audio.mp3' },
  }, '2026-05-12T00:02:00.000Z');

  assert.deepEqual(state.videos.v1, {
    status: 'done',
    contentHash: 'hash-1',
    title: 'Updated title',
    artifacts: { notesPath: '/tmp/old.md', audioPath: '/tmp/audio.mp3' },
    updatedAt: '2026-05-12T00:02:00.000Z',
  });
});

test('markVideo clears stale error when transitioning to done', () => {
  const state: YoutubeState = { version: 1, playlists: {}, videos: {} };

  markVideo(state, 'v1', {
    status: 'skipped-no-transcript',
    error: 'No transcript available for YouTube video v1',
    artifacts: {},
  }, '2026-05-12T00:00:00.000Z');
  assert.equal(state.videos.v1.error, 'No transcript available for YouTube video v1');

  markVideo(state, 'v1', {
    status: 'done',
    contentHash: 'hash-1',
    artifacts: { notesPath: '/tmp/v1.md' },
  }, '2026-05-12T00:01:00.000Z');

  assert.equal(state.videos.v1.status, 'done');
  assert.equal(state.videos.v1.error, undefined);
  assert.ok(!('error' in state.videos.v1));
});

test('markVideo preserves error on partial status when patch supplies one', () => {
  const state: YoutubeState = { version: 1, playlists: {}, videos: {} };

  markVideo(state, 'v1', {
    status: 'partial',
    error: 'video assembly failed',
    artifacts: {},
  }, '2026-05-12T00:00:00.000Z');

  assert.equal(state.videos.v1.error, 'video assembly failed');
});

test('markVideo lets explicit undefined artifact values clear stale keys on serialization', async () => {
  const state: YoutubeState = { version: 1, playlists: {}, videos: {} };
  markVideo(state, 'v1', {
    status: 'partial',
    artifacts: { notesPath: '/n.md', audioPath: '/audio.mp3', videoOverview: 'failed-degraded-to-audio' },
  }, '2026-05-12T00:00:00.000Z');

  markVideo(state, 'v1', {
    status: 'done',
    artifacts: { notesPath: '/n.md', audioPath: undefined, videoPath: '/v.mp4', videoOverview: undefined },
  }, '2026-05-12T00:01:00.000Z');

  const serialized = JSON.parse(JSON.stringify(state.videos.v1));
  assert.deepEqual(serialized.artifacts, { notesPath: '/n.md', videoPath: '/v.mp4' });
});

test('shouldProcess skips done videos with matching hash unless forced', () => {
  const state: YoutubeState = {
    version: 1,
    playlists: {},
    videos: {
      v1: {
        status: 'done',
        contentHash: 'hash-1',
        artifacts: {},
        updatedAt: '2026-05-12T00:00:00.000Z',
      },
    },
  };

  assert.equal(shouldProcess(state, 'v1', 'hash-1', false), false);
  assert.equal(shouldProcess(state, 'v1', 'hash-2', false), true);
  assert.equal(shouldProcess(state, 'v1', 'hash-1', true), true);
  assert.equal(shouldProcess(state, 'new-video', 'hash-1', false), true);
});
