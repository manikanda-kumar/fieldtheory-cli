import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readBrowserBookmarks, planImport, importBookmarks, postRaindrop } from '../scripts/sync-browser-bookmarks.mjs';

const date = (iso: string) => String((BigInt(Date.parse(iso)) + 11644473600000n) * 1000n);
const bookmark = (url: string, added = '2020-01-02T00:00:00Z') => ({
  type: 'url', url, name: 'Saved title', date_added: date(added),
});
function fixture(t: test.TestContext) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-browser-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const write = (file: string, nodes: unknown[]) => fs.writeFileSync(path.join(directory, file),
    JSON.stringify({ roots: { bookmark_bar: { children: [{ children: nodes }] } } }));
  return { directory, write };
}

test('reads both bookmark stores, merges cross-browser URLs and preserves earliest save date', t => {
  const chrome = fixture(t), vivaldi = fixture(t);
  chrome.write('AccountBookmarks', [bookmark('https://example.com/read?utm_source=chrome#section', '2021-01-02T00:00:00Z')]);
  vivaldi.write('Bookmarks', [bookmark('https://example.com/read')]);
  vivaldi.write('AccountBookmarks', [bookmark('https://other.example/')]);
  const result = readBrowserBookmarks([{ name: 'chrome', directory: chrome.directory }, { name: 'vivaldi', directory: vivaldi.directory }]);
  assert.equal(result.records.size, 2);
  const record = result.records.get('https://example.com/read');
  assert.deepEqual(record.tags, ['chrome', 'vivaldi']);
  assert.equal(record.created, '2020-01-02T00:00:00.000Z');
  assert.match(record.link, /#section$/);
  assert.deepEqual(result.counts, { chrome: 1, vivaldi: 2 });
});

test('skips unsupported URLs, embedded credentials, missing/future dates; rejects missing/malformed profiles', t => {
  const f = fixture(t), profiles = [{ name: 'chrome', directory: f.directory }];
  assert.throws(() => readBrowserBookmarks(profiles), /No bookmark files/);
  f.write('Bookmarks', [bookmark('javascript:alert(1)'), bookmark('file:///tmp/private'),
    bookmark('https://user:pass@example.com'), bookmark('https://future.example', '2100-01-01'),
    { ...bookmark('https://missing.example'), date_added: '0' },
    { ...bookmark('https://invalid.example'), date_added: 'abc' }]);
  const result = readBrowserBookmarks(profiles);
  assert.equal(result.skipped, 6);
  assert.equal(result.records.size, 0);
  fs.writeFileSync(path.join(f.directory, 'AccountBookmarks'), '{}');
  assert.throws(() => readBrowserBookmarks(profiles), /Invalid chrome/);
});

test('whole-account pagination deduplicates normalized URLs and fails closed on API errors', async () => {
  const records = new Map([['https://example.com/', { link: 'https://example.com/' }],
    ['https://new.example/', { link: 'https://new.example/' }]]);
  const pages: number[] = [];
  const pending = await planImport(records, async (collection: number, page: number, size: number) => {
    assert.equal(collection, 0); assert.equal(size, 50); pages.push(page);
    return { result: true, items: page === 0
      ? Array.from({ length: 50 }, () => ({ link: 'https://example.com/?utm_campaign=old#anchor' })) : [] };
  });
  assert.deepEqual(pages, [0, 1]);
  assert.deepEqual(pending, [{ link: 'https://new.example/' }]);
  await assert.rejects(planImport(records, async () => ({ result: false })), /Invalid Raindrop inventory/);
});

test('creates a dedicated collection, batches at100, preserves dates, and does nothing on repeat', async () => {
  const items = Array.from({ length: 101 }, (_, i) => ({ link: `https://example.com/${i}`, created: '2020-01-02T00:00:00.000Z', tags: ['chrome'] }));
  const calls: string[] = [];
  const created = await importBookmarks(items, async () => ({ result: true, items: [] }), async (endpoint: string, body: any) => {
    calls.push(endpoint);
    if (endpoint === 'collection') return { result: true, item: { _id: 123 } };
    assert.ok(body.items.length <= 100);
    for (const item of body.items) { assert.equal(item.created, items[0].created); assert.equal(item.collection.$id, 123); }
    return { result: true, items: body.items };
  });
  assert.equal(created, 101);
  assert.deepEqual(calls, ['collection', 'raindrops', 'raindrops']);
  const records = new Map(items.map(i => [i.link, i]));
  const pending = await planImport(records, async (_c: number, page: number) => ({ result: true, items: items.slice(page * 50, (page + 1) * 50) }));
  assert.equal(await importBookmarks(pending, () => assert.fail('No collection access on no-op')), 0);
});

test('reuses collection, rejects ambiguous collections and partial writes without retry', async () => {
  const item = { link: 'https://example.com/' };
  const collection = { _id: 12, title: 'Browser Bookmarks' };
  let calls = 0;
  await assert.rejects(importBookmarks([item], async () => ({ result: true, items: [collection] }), async (endpoint: string) => {
    calls++; assert.equal(endpoint, 'raindrops'); return { result: true, items: [] };
  }), /Incomplete browser import/);
  assert.equal(calls, 1);
  await assert.rejects(importBookmarks([item], async () => ({ result: true, items: [collection, collection] })), /Ambiguous/);
});

test('only explicit429 rejections are retried, with bounded waits; ambiguous failures are not', async t => {
  const oldToken = process.env.RAINDROP_TOKEN;
  process.env.RAINDROP_TOKEN = 'fixture-token';
  t.after(() => { if (oldToken === undefined) delete process.env.RAINDROP_TOKEN; else process.env.RAINDROP_TOKEN = oldToken; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    calls++; assert.equal(options.method, 'POST'); return new Response('sensitive response', { status: 429 });
  });
  const waits: number[] = [];
  await assert.rejects(postRaindrop('raindrops', { items: [] }, async (ms: number) => { waits.push(ms); }), /HTTP 429; re-inventory/);
  assert.equal(calls, 3);
  assert.deepEqual(waits, [60000, 60000]);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('network failure'); });
  await assert.rejects(postRaindrop('raindrops', {}), /network failure/);
  assert.equal(calls, 4);
  t.mock.restoreAll();
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('{}', { status: 500 }); });
  await assert.rejects(postRaindrop('raindrops', {}), /HTTP 500/);
  assert.equal(calls, 5);
});

test('rejects server date changes instead of silently flooding the daily digest', async () => {
  const item = { link: 'https://example.com/', created: '2020-01-02T00:00:00.000Z' };
  await assert.rejects(importBookmarks([item], async () => ({ result: true, items: [{ _id: 12, title: 'Browser Bookmarks' }] }),
    async () => ({ result: true, items: [{ ...item, created: '2026-10-02T00:00:00Z' }] })), /changed save date/);
});
