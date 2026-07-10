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

test('renderXListHtml emits sortable metric data attributes and a sort toolbar', () => {
  const html = renderXListHtml({ listId: '197', fetchedAt: '2026-06-04T00:00:00Z', tweets: [baseTweet] });

  assert.match(html, /data-likes="10"/);
  assert.match(html, /data-reposts="2"/);
  assert.match(html, /data-replies="3"/);
  assert.match(html, /data-quotes="1"/);
  assert.match(html, /data-views="1000"/);
  assert.match(html, /data-time="\d+"/);
  assert.match(html, /class="sortbar"/);
  assert.match(html, /button type="button" data-sort="reposts"/);
});

test('renderXListHtml defaults missing engagement metrics to zero', () => {
  const html = renderXListHtml({
    listId: '197',
    fetchedAt: '2026-06-04T00:00:00Z',
    tweets: [{ ...baseTweet, engagement: undefined }],
  });

  assert.match(html, /data-likes="0"/);
  assert.match(html, /data-views="0"/);
});

test('renderXListHtml linkifies bare URLs inside tweet text', () => {
  const html = renderXListHtml({
    listId: '197',
    fetchedAt: '2026-06-04T00:00:00Z',
    tweets: [{ ...baseTweet, text: 'see https://t.co/abc123 for more.' }],
  });

  assert.match(html, /<a href="https:\/\/t\.co\/abc123" target="_blank" rel="noreferrer">https:\/\/t\.co\/abc123<\/a> for more\./);
});

test('renderXListHtml badges links by source type', () => {
  const html = renderXListHtml({
    listId: '197',
    fetchedAt: '2026-06-04T00:00:00Z',
    tweets: [{
      ...baseTweet,
      links: [
        'https://github.com/foo/bar',
        'https://youtu.be/abc',
        'https://huggingface.co/models/x',
        'https://arxiv.org/abs/2401.00001',
        'https://example.com/post',
      ],
    }],
  });

  assert.match(html, /<span class="link-badge github">GitHub<\/span>/);
  assert.match(html, /<span class="link-badge youtube">YouTube<\/span>/);
  assert.match(html, /<span class="link-badge huggingface">Hugging Face<\/span>/);
  assert.match(html, /<span class="link-badge arxiv">arXiv<\/span>/);
  assert.match(html, /<span class="link-badge other">example\.com<\/span>/);
});

test('renderXListHtml tags cards with link-type slugs and renders a filter bar', () => {
  const html = renderXListHtml({
    listId: '197',
    fetchedAt: '2026-06-04T00:00:00Z',
    tweets: [{ ...baseTweet, links: ['https://github.com/foo/bar', 'https://youtu.be/abc'] }],
  });

  assert.match(html, /data-link-types="github youtube"/);
  assert.match(html, /class="filterbar"/);
  assert.match(html, /button type="button" data-filter="" class="active">All</);
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

test('renderXListHtml embeds an inline video player with poster and mp4 source', () => {
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

  assert.match(html, /<video controls preload="none" playsinline poster="https:\/\/pbs\.twimg\.com\/media\/poster\.jpg" src="https:\/\/video\.twimg\.com\/ext_tw_video\/video\.mp4"><\/video>/);
});

test('renderXListHtml falls back to a poster with a play badge when no mp4 variant', () => {
  const html = renderXListHtml({
    listId: '197',
    fetchedAt: '2026-06-04T00:00:00Z',
    tweets: [{
      ...baseTweet,
      links: [],
      mediaObjects: [{ type: 'video', url: 'https://pbs.twimg.com/media/poster.jpg' }],
    }],
  });

  assert.match(html, /media-item video no-src/);
  assert.match(html, /<img src="https:\/\/pbs\.twimg\.com\/media\/poster\.jpg" alt="Video preview" loading="lazy">/);
});

test('renderXListHtml renders link preview cards with favicon, host, and path', () => {
  const html = renderXListHtml({
    listId: '197',
    fetchedAt: '2026-06-04T00:00:00Z',
    tweets: [{ ...baseTweet, links: ['https://example.com/blog/post?a=1'] }],
  });

  assert.match(html, /class="link-card other"/);
  assert.match(html, /class="link-favicon" src="https:\/\/www\.google\.com\/s2\/favicons\?domain=example\.com&amp;sz=64"/);
  assert.match(html, /<span class="link-host">example\.com<\/span>/);
  assert.match(html, /<span class="link-tail">\/blog\/post\?a=1<\/span>/);
});

test('renderXListHtml gives X-family links human labels instead of numeric ids', () => {
  const html = renderXListHtml({
    listId: '197',
    fetchedAt: '2026-06-04T00:00:00Z',
    tweets: [{
      ...baseTweet,
      links: ['http://x.com/i/article/2075070857827819520', 'https://x.com/paulsolt/status/2075336345300377615'],
    }],
  });

  assert.match(html, /<span class="link-badge x">X Article<\/span>/);
  assert.match(html, /<span class="link-host">X Article<\/span>/);
  assert.match(html, /<span class="link-host">@paulsolt<\/span>/);
  assert.match(html, /<span class="link-tail">Post on X<\/span>/);
  // The opaque numeric article id must not surface as the card detail.
  assert.doesNotMatch(html, /2075070857827819520<\/span>/);
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
