import test from 'node:test';
import assert from 'node:assert/strict';
import { readVivaldiSessions, sessionRecords } from '../scripts/sync-vivaldi-tabs.mjs';
import { importBookmarks } from '../scripts/sync-browser-bookmarks.mjs';

const timestamp = Date.parse('2026-09-01T12:00:00Z') / 1000;
const tab = { title: 'Article', url: 'https://example.com/read', timestamp };

test('remote tab records deduplicate, preserve activity dates/provenance, and reject unsafe URLs/dates', () => {
  const input = [{ device: 'Phone', tabs: [tab, { ...tab, url: tab.url + '?utm_source=test#section' },
    { ...tab, url: 'chrome://newtab' }, { ...tab, url: 'https://user:password@example.com' },
    { ...tab, timestamp: 0 }, { ...tab, timestamp: NaN }, { ...tab, timestamp: 1e20 }] }];
  const result = sessionRecords(input);
  assert.equal(result.records.size, 1);
  assert.equal(result.skipped, 5);
  const item = [...result.records.values()][0];
  assert.equal(item.created, '2026-09-01T12:00:00.000Z');
  assert.deepEqual(item.tags, ['vivaldi', 'synced-tabs']);
  assert.match(item.note, /Phone.*last tab activity/);
  assert.throws(() => sessionRecords([{ device: 'Phone' }]), /Invalid remote session/);
});

test('Unix-second timestamps are not treated as Chrome 1601-epoch values', () => {
  const chromeEpochish = (Date.parse('2026-09-01T12:00:00Z') + 11644473600000) * 1000;
  const result = sessionRecords([{ device: 'Phone', tabs: [{ ...tab, timestamp: chromeEpochish }] }]);
  assert.equal(result.records.size, 0);
  assert.equal(result.skipped, 1);
});

test('excluded devices contribute no tabs or provenance, including URLs shared with personal devices', () => {
  const input = [
    { device: 'Work laptop', tabs: [tab, { ...tab, url: 'https://internal.example/work-only' }] },
    { device: 'Phone', tabs: [{ ...tab, title: 'Personal article' }] },
    { device: 'Work laptop 2', tabs: [{ ...tab, url: 'https://example.net/personal' }] },
  ];
  const result = sessionRecords(input, Date.now(), ['Work laptop']);
  const items = [...result.records.values()];
  assert.deepEqual(items.map(item => item.link), ['https://example.com/read', 'https://example.net/personal']);
  assert.equal(items[0].title, 'Personal article');
  assert.match(items[0].note, /Phone/);
  assert.match(items[1].note, /Work laptop 2/);
  assert.equal(sessionRecords(input).records.size, 3);
});

test('reader uses Vivaldi sessions API and always closes the CDP session', async () => {
  const devices = [{ device: 'Phone', lastUpdate: '1756728000', tabs: [tab] }];
  let closed = 0;
  const result = await readVivaldiSessions(async () => ({
    evaluate: async (expression: string) => {
      assert.match(expression, /chrome\.sessions\.getDevices/);
      return devices;
    },
    close: async () => { closed++; },
  }));
  assert.deepEqual(result, devices);
  assert.equal(closed, 1);
});

test('reader cleans up on timeout, malformed/empty response, and close failure', async () => {
  for (const failure of ['evaluate', 'empty', 'close']) {
    let closed = 0;
    await assert.rejects(() => readVivaldiSessions(async () => ({
      evaluate: async () => {
        if (failure === 'evaluate') throw new Error('fixture');
        return failure === 'empty' ? [] : [{ device: 'Phone', tabs: [tab] }];
      },
      close: async () => {
        closed++;
        if (failure === 'close') throw new Error('fixture');
      },
    })));
    assert.equal(closed, 1);
  }
});

test('tab importer targets Vivaldi Saved Tabs rather than Browser Bookmarks', async () => {
  const item = [...sessionRecords([{ device: 'Mac', tabs: [tab] }]).records.values()][0];
  let posts = 0;
  assert.equal(await importBookmarks([item], async () => ({ result: true, items: [
    { _id: 1, title: 'Browser Bookmarks' }, { _id: 2, title: 'Vivaldi Saved Tabs' },
  ] }), async (endpoint: string, body: any) => {
    posts++; assert.equal(endpoint, 'raindrops'); assert.equal(body.items[0].collection.$id, 2);
    return { result: true, items: body.items };
  }, 'Vivaldi Saved Tabs'), 1);
  assert.equal(posts, 1);
});
