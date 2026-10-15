#!/usr/bin/env node
// Caller holds sync-orb.lock. Reads Chrome's foreign-session UI, never local history.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeBookmarkUrl } from '../dist/url-normalize.js';
import { planImport, importBookmarks } from './sync-browser-bookmarks.mjs';

const browserArgs = ['--namespace', 'fieldtheory-feed', '--session', 'chrome-tabs', '--cdp', '9225', '--pin-tab'];
function browser(...args) {
  try {
    return execFileSync('agent-browser', [...browserArgs, ...args], {
      encoding: 'utf8', timeout: 40_000, maxBuffer: 4 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error('Chrome tab reader failed; check headless Chrome/CDP9225 and signed-in tab sync.');
  }
}

export function readChromeSessions(run = browser) {
  let opened = false;
  try {
    run('tab', 'new', 'chrome://history/syncedTabs');
    opened = true;
    // A missing/empty view can mean expired auth or unloaded sync: fail visibly,
    // not as a successful empty import. Do not click sign-in or change settings.
    run('wait', '--fn', `document.querySelector('history-app')?.shadowRoot
      ?.querySelector('history-synced-device-manager')?.shadowRoot
      ?.querySelectorAll('history-synced-device-card').length > 0`);
    const response = JSON.parse(run('eval', `Array.from(document.querySelector('history-app').shadowRoot
      .querySelector('history-synced-device-manager').shadowRoot
      .querySelectorAll('history-synced-device-card')).map(c => ({
        device: c.device, lastUpdate: c.lastUpdateTime,
        tabs: c.tabs.map(t => ({title: t.title, url: t.url, timestamp: t.timestamp}))
      }))`, '--json'));
    if (!response.success || !Array.isArray(response.data?.result) || !response.data.result.length) {
      throw new Error('Chrome returned no remote sessions; verify tab sync.');
    }
    return response.data.result;
  } finally {
    // Close only this reader's pinned tab; always detach the daemon. The managed
    // signed-in browser and its original blank tab remain alive for background sync.
    try { if (opened) run('tab', 'close'); } finally { run('close'); }
  }
}

export function sessionRecords(sessions, now = Date.now(), excludedDevices = []) {
  const records = new Map();
  let skipped = 0;
  for (const session of sessions) {
    if (typeof session.device !== 'string' || !Array.isArray(session.tabs)) throw new Error('Invalid remote session');
    if (excludedDevices.includes(session.device)) continue;
    for (const tab of session.tabs) {
      let url, created;
      try {
        url = new URL(tab.url);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
        const ms = Number(tab.timestamp) / 1000 - 11644473600000;
        if (!Number.isFinite(ms) || ms <= 0 || ms > now) throw new Error();
        created = new Date(ms).toISOString();
      } catch { skipped++; continue; }
      const key = normalizeBookmarkUrl(url.href);
      if (!records.has(key)) {
        records.set(key, { link: url.href, title: tab.title || url.hostname, created,
          tags: ['chrome', 'synced-tabs'],
          note: `Remote open tab from ${session.device}. Date reflects last tab activity, not bookmark creation.` });
      }
    }
  }
  return { records, skipped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !['--run', '--dry-run'].includes(process.argv[2])) {
      throw new Error('Usage: node scripts/sync-chrome-tabs.mjs --dry-run|--run (hold sync-orb.lock)');
    }
    let excludedDevices = [];
    try {
      excludedDevices = fs.readFileSync(path.join(os.homedir(), '.config/fieldtheory/chrome-tabs-excluded-devices'), 'utf8')
        .split(/\r?\n/).map(name => name.trim()).filter(Boolean);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const sessions = readChromeSessions();
    const { records, skipped } = sessionRecords(sessions, Date.now(), excludedDevices);
    const pending = await planImport(records);
    console.log(JSON.stringify({ chromeDevices: sessions.map(s => ({ device: s.device, tabs: s.tabs.length,
      lastUpdate: s.lastUpdate, excluded: excludedDevices.includes(s.device) })),
      uniqueWebTabs: records.size, skipped, existing: records.size - pending.length, toCreate: pending.length,
      dryRun: process.argv[2] === '--dry-run' }));
    if (process.argv[2] === '--run') await importBookmarks(pending, undefined, undefined, 'Chrome Saved Tabs');
  } catch (error) {
    console.error(`Chrome tab feed failed: ${error.message}`);
    process.exitCode = 1;
  }
}
