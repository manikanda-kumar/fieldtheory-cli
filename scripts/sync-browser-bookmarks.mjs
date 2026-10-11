#!/usr/bin/env node
// Caller holds sync-orb.lock. Read bookmarks only; never read cookies or tokens from profiles.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeBookmarkUrl } from '../dist/url-normalize.js';
import { fetchCollections, fetchRaindropsPage } from '../dist/raindrop/client.js';

const collectionTitle = 'Browser Bookmarks';

export function readBrowserBookmarks(profiles, now = Date.now()) {
  const records = new Map();
  const counts = {};
  let skipped = 0;
  for (const { name, directory } of profiles) {
    let files = 0;
    counts[name] = 0;
    function visit(node) {
      if (node.type === 'url') {
        counts[name]++;
        let url, created;
        try {
          url = new URL(node.url);
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
          // Chromium stores microseconds since 1601. Never turn unknown dates into today's saves.
          if (!/^\d+$/.test(node.date_added)) throw new Error();
          const ms = Number(BigInt(node.date_added) / 1000n - 11644473600000n);
          if (ms <= 0 || ms > now) throw new Error();
          created = new Date(ms).toISOString();
        } catch {
          skipped++;
          return;
        }
        const key = normalizeBookmarkUrl(url.href);
        const previous = records.get(key);
        if (previous) {
          if (created < previous.created) previous.created = created;
          if (!previous.tags.includes(name)) previous.tags.push(name);
        } else {
          records.set(key, { link: url.href, title: node.name || url.hostname, created, tags: [name] });
        }
      }
      for (const child of node.children ?? []) visit(child);
    }
    // Chrome uses AccountBookmarks; Vivaldi can migrate between these files.
    for (const filename of ['Bookmarks', 'AccountBookmarks']) {
      const file = path.join(directory, filename);
      if (!fs.existsSync(file)) continue;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!data.roots || typeof data.roots !== 'object') throw new Error(`Invalid ${name} ${filename}`);
      for (const root of Object.values(data.roots)) visit(root);
      files++;
    }
    if (!files) throw new Error(`No bookmark files for ${name}; preserve its signed-in profile.`);
  }
  return { records, counts, skipped };
}

export async function planImport(records, fetchPage = fetchRaindropsPage) {
  const existing = new Set();
  // Scan the whole account, not just browser collections or a potentially stale local cache.
  for (let page = 0; ; page++) {
    const result = await fetchPage(0, page, 50);
    if (result.result !== true || !Array.isArray(result.items)) throw new Error('Invalid Raindrop inventory response');
    for (const item of result.items) {
      try { existing.add(normalizeBookmarkUrl(item.link)); } catch { /* Non-web legacy items. */ }
    }
    if (result.items.length < 50) break;
  }
  return [...records].filter(([key]) => !existing.has(key)).map(([, record]) => record);
}

export async function postRaindrop(endpoint, body, wait = ms => new Promise(resolve => setTimeout(resolve, ms))) {
  const token = process.env.RAINDROP_TOKEN || process.env.RAINDROP_TEST_TOKEN;
  if (!token) throw new Error('Raindrop token is missing');
  for (let attempt = 0; attempt < 3; attempt++) {
    // Only explicit rate-limit rejections are retryable. Lost responses or 5xx
    // may have committed a write; the next run must re-inventory those.
    const response = await fetch(`https://api.raindrop.io/rest/v1/${endpoint}`, {
      method: 'POST', signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 429 && attempt < 2) {
      const seconds = Number(response.headers.get('retry-after')) || 60;
      if (seconds > 0 && seconds <= 90) {
        await response.body?.cancel();
        console.log(`Browser bookmarks: rate limited; waiting ${seconds}s`);
        await wait(seconds * 1000);
        continue;
      }
    }
    if (!response.ok) throw new Error(`Raindrop ${endpoint} POST HTTP ${response.status}; re-inventory before retrying`);
    const result = await response.json();
    if (result.result !== true) throw new Error(`Raindrop ${endpoint} POST rejected; re-inventory before retrying`);
    return result;
  }
}

export async function importBookmarks(pending, collections = fetchCollections, post = postRaindrop, title = collectionTitle) {
  if (!pending.length) return 0;
  const response = await collections();
  if (response.result !== true || !Array.isArray(response.items)) throw new Error('Invalid Raindrop collections response');
  const matches = response.items.filter(c => c.title === title && !c.parent);
  if (matches.length > 1) throw new Error(`Ambiguous ${title} collections`);
  const collection = matches[0] ?? (await post('collection', { title })).item;
  if (!Number.isSafeInteger(collection?._id)) throw new Error('Invalid browser collection ID');
  let created = 0;
  for (let i = 0; i < pending.length; i += 100) {
    const batch = pending.slice(i, i + 100);
    const result = await post('raindrops', {
      items: batch.map(item => ({ ...item, collection: { $id: collection._id } })),
    });
    const returned = new Map((result.items ?? []).map(item => [normalizeBookmarkUrl(item.link), item]));
    if (result.items?.length !== batch.length || batch.some(item =>
      Date.parse(returned.get(normalizeBookmarkUrl(item.link))?.created) !== Date.parse(item.created))) {
      throw new Error('Incomplete browser import response or changed save date; re-inventory before retrying');
    }
    created += batch.length;
    console.log(`Browser bookmarks: ${created}/${pending.length} created`);
  }
  return created;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !['--run', '--dry-run'].includes(process.argv[2])) {
      throw new Error('Usage: node scripts/sync-browser-bookmarks.mjs --dry-run|--run (hold sync-orb.lock)');
    }
    const home = os.homedir();
    const input = readBrowserBookmarks([
      { name: 'chrome', directory: path.join(home, '.config/fieldtheory-browser-profiles/chrome/Default') },
      { name: 'vivaldi', directory: path.join(home, '.config/vivaldi/Default') },
    ]);
    const pending = await planImport(input.records);
    console.log(JSON.stringify({ browserBookmarks: input.counts, unique: input.records.size,
      invalidOrUnsupported: input.skipped, alreadyInRaindrop: input.records.size - pending.length,
      toCreate: pending.length, dryRun: process.argv[2] === '--dry-run' }));
    if (process.argv[2] === '--run') await importBookmarks(pending);
  } catch (error) {
    console.error(`Browser bookmark feed failed: ${error.message}`);
    process.exitCode = 1;
  }
}
