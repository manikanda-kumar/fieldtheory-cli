import test from 'node:test';
import assert from 'node:assert/strict';
import { readChromeSessions, sessionRecords } from '../scripts/sync-chrome-tabs.mjs';
import { importBookmarks } from '../scripts/sync-browser-bookmarks.mjs';

const timestamp = (Date.parse('2026-09-01T12:00:00Z') + 11644473600000) * 1000;
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
  assert.deepEqual(item.tags, ['chrome', 'synced-tabs']);
  assert.match(item.note, /Phone.*last tab activity/);
  assert.throws(() => sessionRecords([{ device: 'Phone' }]), /Invalid remote session/);
});

test('reader uses foreign-session page and always closes its own tab and daemon', () => {
  const calls: string[][] = [];
  const devices = [{ device: 'Phone', tabs: [tab] }];
  const result = readChromeSessions((...args: string[]) => {
    calls.push(args);
    return args[0] === 'eval' ? JSON.stringify({ success: true, data: { result: devices } }) : '';
  });
  assert.deepEqual(result, devices);
  assert.deepEqual(calls[0], ['tab', 'new', 'chrome://history/syncedTabs']);
  assert.deepEqual(calls.slice(-2), [['tab', 'close'], ['close']]);
  assert.match(calls[2][1], /history-synced-device-card/);
});

test('reader cleans up on timeout, malformed/empty response, and tab-close failure', () => {
  for (const failure of ['wait', 'eval', 'tab-close']) {
    const calls: string[][] = [];
    assert.throws(() => readChromeSessions((...args: string[]) => {
      calls.push(args);
      if (args[0] === failure || (failure === 'tab-close' && args.join(' ') === 'tab close')) throw new Error('fixture');
      return args[0] === 'eval' ? '{"success":true,"data":{"result":[]}}' : '';
    }));
    assert.deepEqual(calls.at(-1), ['close']);
  }
});

test('tab importer targets Chrome Saved Tabs rather than Browser Bookmarks', async () => {
  const item = [...sessionRecords([{ device: 'Mac', tabs: [tab] }]).records.values()][0];
  let posts = 0;
  assert.equal(await importBookmarks([item], async () => ({ result: true, items: [
    { _id: 1, title: 'Browser Bookmarks' }, { _id: 2, title: 'Chrome Saved Tabs' },
  ] }), async (endpoint: string, body: any) => {
    posts++; assert.equal(endpoint, 'raindrops'); assert.equal(body.items[0].collection.$id, 2);
    return { result: true, items: body.items };
  }, 'Chrome Saved Tabs'), 1);
  assert.equal(posts, 1);
});
