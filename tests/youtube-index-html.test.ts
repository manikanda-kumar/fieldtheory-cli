import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { renderYoutubeIndexHtml, writeYoutubePlaylistIndex } from '../src/youtube/index-html.js';

test('renderYoutubeIndexHtml renders a sidebar, grouped video cards, thumbnails, and escaped content', () => {
  const html = renderYoutubeIndexHtml({
    generatedAt: '2026-05-21T00:00:00.000Z',
    youtubeRoot: '/tmp/library/youtube',
    entries: [{
      videoId: 'v1',
      title: '<Great> Video',
      channel: 'Channel & Co',
      videoType: 'tutorial',
      durationSec: 600,
      published: '20260512',
      synced: '2026-05-21T00:00:00.000Z',
      tldr: 'A useful walkthrough.',
      topics: ['AI', 'Agents'],
      notesPath: path.join('/tmp/library/youtube', '2026-05', 'v1.md'),
      thumbnailPath: 'https://i.ytimg.com/vi/v1/hqdefault.jpg',
      slideCount: 2,
      audioPath: path.join('/tmp/data/youtube/artifacts/v1/v1.overview.mp3'),
    }],
  });

  assert.match(html, /<aside class="sidebar">/);
  assert.match(html, /Tutorials/);
  assert.match(html, /2026-05/);
  assert.match(html, /&lt;Great&gt; Video/);
  assert.doesNotMatch(html, /<Great> Video/);
  assert.match(html, /img src="https:\/\/i\.ytimg\.com\/vi\/v1\/hqdefault\.jpg"/);
  assert.match(html, /href="2026-05\/v1\.md"/);
  assert.match(html, /data-video-type="tutorial"/);
  assert.match(html, /Slides 2/);
  assert.match(html, /Audio/);
});

function extractIds(html: string): string[] {
  const match = html.match(/id="youtube-index-data"[^>]*>(.*?)<\/script>/s);
  if (!match) throw new Error('no embedded index data');
  return (JSON.parse(match[1].replace(/\\u003c/g, '<')) as Array<{ videoId: string }>).map((e) => e.videoId).sort();
}

async function withYoutubeState(
  videos: Record<string, unknown>,
  playlists: Record<string, { videoIds: string[]; lastSyncedAt: string }>,
  fn: () => Promise<void>,
): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-yt-idx-'));
  const prevData = process.env.FT_DATA_DIR;
  const prevLib = process.env.FT_LIBRARY_DIR;
  process.env.FT_DATA_DIR = root;
  process.env.FT_LIBRARY_DIR = path.join(root, 'library');
  try {
    fs.mkdirSync(path.join(root, 'library', 'youtube'), { recursive: true });
    fs.mkdirSync(path.join(root, 'youtube'), { recursive: true });
    fs.writeFileSync(path.join(root, 'youtube', 'state.json'), JSON.stringify({ version: 1, playlists, videos }));
    await fn();
  } finally {
    if (prevData === undefined) delete process.env.FT_DATA_DIR; else process.env.FT_DATA_DIR = prevData;
    if (prevLib === undefined) delete process.env.FT_LIBRARY_DIR; else process.env.FT_LIBRARY_DIR = prevLib;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const doneVideo = (title: string) => ({
  status: 'done',
  title,
  artifacts: { notesPath: `/notes/${title}.md` },
  updatedAt: '2026-07-01T00:00:00.000Z',
});

test('writeYoutubePlaylistIndex scopes to playlist members and dedupes ids', async () => {
  await withYoutubeState(
    { a: doneVideo('a'), b: doneVideo('b'), c: doneVideo('c') },
    { PL1: { videoIds: ['a', 'a', 'b'], lastSyncedAt: '2026-07-01T00:00:00.000Z' } },
    async () => {
      const out = await writeYoutubePlaylistIndex('PL1');
      assert.ok(out && out.endsWith('index-PL1.html'));
      assert.deepEqual(extractIds(fs.readFileSync(out!, 'utf8')), ['a', 'b']);
    },
  );
});

test('writeYoutubePlaylistIndex returns null when no members have notes', async () => {
  await withYoutubeState(
    { a: { status: 'pending', title: 'a', artifacts: {}, updatedAt: '2026-07-01T00:00:00.000Z' } },
    { PL1: { videoIds: ['a'], lastSyncedAt: '2026-07-01T00:00:00.000Z' } },
    async () => {
      assert.equal(await writeYoutubePlaylistIndex('PL1'), null);
    },
  );
});
