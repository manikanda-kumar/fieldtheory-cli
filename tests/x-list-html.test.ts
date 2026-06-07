import test from 'node:test';
import assert from 'node:assert/strict';
import { renderXListHtml, type XListHtmlTweet } from '../src/x-list-html.js';

const baseTweet: XListHtmlTweet = {
  id: '1',
  timelineKind: 'list-tweet',
  url: 'https://x.com/alice/status/1',
  author: 'alice',
  authorName: 'Alice',
  postedAt: 'Thu Jun 04 03:45:00 +0000 2026',
  text: 'Hello <script>alert(1)</script> world',
  links: ['https://example.com/path?a=1&b=2'],
  engagement: { likeCount: 10, repostCount: 2, replyCount: 3, quoteCount: 1, viewCount: 1000 },
};

test('renderXListHtml escapes tweet text and renders section counts', () => {
  const html = renderXListHtml({ listId: '197', fetchedAt: '2026-06-04T00:00:00Z', tweets: [baseTweet] });

  assert.match(html, /List tweets <span>1<\/span>/);
  assert.match(html, /Conversation context <span>0<\/span>/);
  assert.match(html, /Hello &lt;script&gt;alert\(1\)&lt;\/script&gt; world/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('renderXListHtml renders inline images from media objects', () => {
  const html = renderXListHtml({
    listId: '197',
    fetchedAt: '2026-06-04T00:00:00Z',
    tweets: [{
      ...baseTweet,
      mediaObjects: [{ type: 'photo', url: 'https://pbs.twimg.com/media/photo.jpg', altText: 'diagram <one>' }],
    }],
  });

  assert.match(html, /<img src="https:\/\/pbs\.twimg\.com\/media\/photo\.jpg" alt="diagram &lt;one&gt;" loading="lazy">/);
});

test('renderXListHtml renders video preview with source link', () => {
  const html = renderXListHtml({
    listId: '197',
    fetchedAt: '2026-06-04T00:00:00Z',
    tweets: [{
      ...baseTweet,
      mediaObjects: [{
        type: 'video',
        url: 'https://pbs.twimg.com/media/poster.jpg',
        videoVariants: [{ contentType: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/ext_tw_video/video.mp4' }],
      }],
    }],
  });

  assert.match(html, /<img src="https:\/\/pbs\.twimg\.com\/media\/poster\.jpg" alt="Video preview" loading="lazy">/);
  assert.match(html, /href="https:\/\/video\.twimg\.com\/ext_tw_video\/video\.mp4"/);
  assert.match(html, /Open video/);
});

test('renderXListHtml renders quoted tweets as nested cards', () => {
  const html = renderXListHtml({
    listId: '197',
    fetchedAt: '2026-06-04T00:00:00Z',
    tweets: [{
      ...baseTweet,
      quotedTweet: {
        id: '55',
        text: 'Quoted <b>text</b>',
        authorHandle: 'bob',
        authorName: 'Bob',
        url: 'https://x.com/bob/status/55',
        mediaObjects: [{ type: 'photo', url: 'https://pbs.twimg.com/media/quote.jpg' }],
      },
    }],
  });

  assert.match(html, /Quoted tweet/);
  assert.match(html, /@bob/);
  assert.match(html, /Quoted &lt;b&gt;text&lt;\/b&gt;/);
  assert.match(html, /quote\.jpg/);
});
