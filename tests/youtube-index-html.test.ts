import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { renderYoutubeIndexHtml } from '../src/youtube/index-html.js';

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
