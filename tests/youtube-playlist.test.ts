import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePlaylist } from '../src/youtube/playlist.js';

const PLAYLIST_HTML = `
<html><script nonce="x">var ytInitialData = {"contents":{"twoColumnBrowseResultsRenderer":{"tabs":[{"tabRenderer":{"content":{"sectionListRenderer":{"contents":[{"itemSectionRenderer":{"contents":[{"playlistVideoListRenderer":{"contents":[
{"playlistVideoRenderer":{"videoId":"vid1","title":{"runs":[{"text":"First Video"}]}}},
{"playlistVideoRenderer":{"videoId":"vid2","title":{"simpleText":"Second Video"}}}
]}}]}}]}}}}]}}};</script></html>`;

test('resolvePlaylist normalizes bare playlist IDs and parses public HTML fallback', async () => {
  const result = await resolvePlaylist('PL123', {
    hasCommand: () => false,
    fetchText: async (url) => {
      assert.equal(url, 'https://www.youtube.com/playlist?list=PL123');
      return PLAYLIST_HTML;
    },
  });

  assert.deepEqual(result, {
    playlistId: 'PL123',
    videos: [
      { videoId: 'vid1', title: 'First Video' },
      { videoId: 'vid2', title: 'Second Video' },
    ],
  });
});

test('resolvePlaylist extracts list IDs from playlist URLs', async () => {
  const result = await resolvePlaylist('https://www.youtube.com/playlist?list=PL456', {
    hasCommand: () => false,
    fetchText: async () => PLAYLIST_HTML,
  });

  assert.equal(result.playlistId, 'PL456');
});

test('resolvePlaylist uses yt-dlp flat playlist output when available', async () => {
  const commands: Array<{ command: string; args: string[] }> = [];
  const result = await resolvePlaylist('PL789', {
    hasCommand: (command) => command === 'yt-dlp',
    runCommand: async (command, args) => {
      commands.push({ command, args });
      return 'abc\tAlpha\ndef\tDelta Video\n';
    },
  });

  assert.deepEqual(result.videos, [
    { videoId: 'abc', title: 'Alpha' },
    { videoId: 'def', title: 'Delta Video' },
  ]);
  assert.equal(commands[0].command, 'yt-dlp');
  assert.deepEqual(commands[0].args, [
    '--flat-playlist',
    '--print',
    '%(id)s\t%(title)s',
    'https://www.youtube.com/playlist?list=PL789',
  ]);
});

test('resolvePlaylist passes yt-dlp browser cookies and impersonation options', async () => {
  const commands: Array<{ command: string; args: string[] }> = [];
  await resolvePlaylist('PL789', {
    hasCommand: (command) => command === 'yt-dlp',
    ytDlp: { cookiesFromBrowser: 'chrome:Profile 1', impersonate: 'chrome' },
    runCommand: async (command, args) => {
      commands.push({ command, args });
      return 'abc\tAlpha\n';
    },
  });

  assert.deepEqual(commands[0].args.slice(0, 4), [
    '--cookies-from-browser',
    'chrome:Profile 1',
    '--impersonate',
    'chrome',
  ]);
});

test('resolvePlaylist fails clearly when no public playlist videos are found', async () => {
  await assert.rejects(
    resolvePlaylist('PLPRIVATE', { hasCommand: () => false, fetchText: async () => '<html></html>' }),
    /No public videos found for playlist PLPRIVATE/,
  );
});
