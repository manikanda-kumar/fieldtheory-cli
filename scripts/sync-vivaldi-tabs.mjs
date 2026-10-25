#!/usr/bin/env node
// Caller holds sync-orb.lock. Reads Vivaldi's chrome.sessions.getDevices() over
// loopback CDP9224. Never uses agent-browser (it hangs on this UI), never reads
// local about:blank tabs, cookies, or tokens, and never opens remote links.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeBookmarkUrl } from '../dist/url-normalize.js';
import { planImport, importBookmarks } from './sync-browser-bookmarks.mjs';

const cdpPort = 9224;
const uiExtension = 'chrome-extension://mpognobbkildjkofajifpdfhcoklimli/';
const devicesExpr = `(async () => {
  if (typeof chrome?.sessions?.getDevices !== 'function') throw new Error('sessions API missing');
  const devices = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('getDevices timeout')), 8000);
    chrome.sessions.getDevices({}, (result) => {
      clearTimeout(timer);
      const err = chrome.runtime?.lastError;
      err ? reject(new Error(err.message || String(err))) : resolve(result);
    });
  });
  if (!Array.isArray(devices) || !devices.length) return [];
  return devices.map((device) => ({
    device: device.deviceName,
    lastUpdate: String(Math.max(0, ...(device.sessions ?? []).map((session) => Number(session.lastModified) || 0))),
    tabs: (device.sessions ?? []).flatMap((session) => (session.window?.tabs ?? []).map((tab) => ({
      title: tab.title, url: tab.url, timestamp: session.lastModified,
    }))),
  }));
})()`;

function failReader() {
  throw new Error('Vivaldi tab reader failed; check headless Vivaldi/CDP9224 and signed-in tab sync.');
}

async function defaultConnect() {
  let list;
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) failReader();
    list = await response.json();
  } catch {
    failReader();
  }
  const target = list.find((item) => (item.url || '').includes(`${uiExtension}window.html`))
    || list.find((item) => (item.url || '').includes(`${uiExtension}main.html`));
  if (!target?.webSocketDebuggerUrl) failReader();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 10_000);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('timeout')); });
    });
  } catch {
    try { ws.close(); } catch { /* never opened */ }
    failReader();
  }
  let nextId = 0;
  const pending = new Map();
  const onMessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) pending.get(message.id)(message);
  };
  ws.addEventListener('message', onMessage);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => reject(new Error('timeout')), 15_000);
    pending.set(id, (message) => { clearTimeout(timer); resolve(message); });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return {
    async evaluate(expression) {
      try {
        await send('Runtime.enable');
        const message = await send('Runtime.evaluate', {
          expression, awaitPromise: true, returnByValue: true, timeout: 10_000,
        });
        const value = message.result?.result?.value;
        if (message.error || message.result?.exceptionDetails || !Array.isArray(value)) failReader();
        return value;
      } catch {
        failReader();
      }
    },
    async close() {
      ws.removeEventListener('message', onMessage);
      try { ws.close(); } catch { /* already closed */ }
    },
  };
}

export async function readVivaldiSessions(connect = defaultConnect) {
  let session;
  try {
    session = await connect();
    const devices = await session.evaluate(devicesExpr);
    if (!devices.length) throw new Error('Vivaldi returned no remote sessions; verify tab sync.');
    return devices;
  } finally {
    await session?.close?.();
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
        // Vivaldi session.lastModified is Unix seconds, not Chrome's 1601 epoch.
        const ms = Number(tab.timestamp) * 1000;
        if (!Number.isFinite(ms) || ms <= 0 || ms > now) throw new Error();
        created = new Date(ms).toISOString();
      } catch { skipped++; continue; }
      const key = normalizeBookmarkUrl(url.href);
      if (!records.has(key)) {
        records.set(key, { link: url.href, title: tab.title || url.hostname, created,
          tags: ['vivaldi', 'synced-tabs'],
          note: `Remote open tab from ${session.device}. Date reflects last tab activity, not bookmark creation.` });
      }
    }
  }
  return { records, skipped };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3 || !['--run', '--dry-run'].includes(process.argv[2])) {
      throw new Error('Usage: node scripts/sync-vivaldi-tabs.mjs --dry-run|--run (hold sync-orb.lock)');
    }
    let excludedDevices = [];
    try {
      excludedDevices = fs.readFileSync(path.join(os.homedir(), '.config/fieldtheory/vivaldi-tabs-excluded-devices'), 'utf8')
        .split(/\r?\n/).map(name => name.trim()).filter(Boolean);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const sessions = await readVivaldiSessions();
    const { records, skipped } = sessionRecords(sessions, Date.now(), excludedDevices);
    const pending = await planImport(records);
    console.log(JSON.stringify({ vivaldiDevices: sessions.map(s => ({ device: s.device, tabs: s.tabs.length,
      lastUpdate: s.lastUpdate, excluded: excludedDevices.includes(s.device) })),
      uniqueWebTabs: records.size, skipped, existing: records.size - pending.length, toCreate: pending.length,
      dryRun: process.argv[2] === '--dry-run' }));
    if (process.argv[2] === '--run') await importBookmarks(pending, undefined, undefined, 'Vivaldi Saved Tabs');
  } catch (error) {
    console.error(`Vivaldi tab feed failed: ${error.message}`);
    process.exitCode = 1;
  }
}
