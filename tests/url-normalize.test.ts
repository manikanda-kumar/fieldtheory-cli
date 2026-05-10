import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBookmarkUrl, dedupeKeyForUrl, dedupeKeyForXBookmark } from '../src/url-normalize.js';

test('normalizeBookmarkUrl lowercases scheme and host, removes fragments and default ports', () => {
  assert.equal(normalizeBookmarkUrl('HTTPS://Example.COM:443/Path?q=1#section'), 'https://example.com/Path?q=1');
});

test('normalizeBookmarkUrl strips tracking params but preserves meaningful params', () => {
  assert.equal(normalizeBookmarkUrl('https://example.com/a?utm_source=x&gclid=abc&id=42&fbclid=z'), 'https://example.com/a?id=42');
});

test('dedupeKeyForUrl prefixes normalized URLs', () => {
  assert.equal(dedupeKeyForUrl('https://Example.com/a?utm_campaign=nope&id=1'), 'url:https://example.com/a?id=1');
});

test('dedupeKeyForXBookmark uses one external link when unambiguous', () => {
  assert.equal(dedupeKeyForXBookmark({ tweetId: '123', links: ['https://github.com/acme/tool'] }), 'url:https://github.com/acme/tool');
});

test('dedupeKeyForXBookmark falls back to tweet id when links are ambiguous', () => {
  assert.equal(dedupeKeyForXBookmark({ tweetId: '123', links: ['https://a.test', 'https://b.test'] }), 'x:123');
});

test('dedupeKeyForXBookmark ignores X, Twitter, and t.co links as non-external', () => {
  assert.equal(dedupeKeyForXBookmark({
    tweetId: '123',
    links: [
      'https://x.com/user/status/123',
      'https://twitter.com/user/status/123',
      'https://t.co/abc',
      'https://Example.com/a?utm_medium=social&id=1#reply',
    ],
  }), 'url:https://example.com/a?id=1');
});

test('dedupeKeyForXBookmark falls back to tweet id with no clear external links', () => {
  assert.equal(dedupeKeyForXBookmark({
    tweetId: '123',
    links: ['https://x.com/user/status/123', 'https://t.co/abc'],
  }), 'x:123');
});
