import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeJson, writeJsonLines } from './fs.js';
import { browserBookmarksCachePath, browserBookmarksMetaPath } from './paths.js';
import { rebuildCanonicalIndex } from './canonical-bookmarks-db.js';

export type BrowserBookmarkProvider = 'chrome' | 'vivaldi' | 'safari';

export interface BrowserBookmarkRecord {
  id: string;
  browser: BrowserBookmarkProvider;
  profile: string;
  sourceItemId: string;
  url: string;
  title: string;
  folderPath: string[];
  dateAdded?: string | null;
  dateModified?: string | null;
  syncedAt: string;
}

interface ChromiumNode {
  type?: string;
  id?: string;
  name?: string;
  url?: string;
  date_added?: string;
  date_modified?: string;
  children?: ChromiumNode[];
}

interface ChromiumBookmarkFile {
  roots?: Record<string, ChromiumNode>;
}

export interface BrowserBookmarkSyncResult {
  browser: BrowserBookmarkProvider;
  profile: string;
  synced: number;
  cachePath: string;
}

export interface SyncBrowserBookmarksOptions {
  browser: BrowserBookmarkProvider;
  profile: string;
  bookmarksPath?: string;
  rebuildCanonical?: boolean;
}

export function chromiumWebkitTimeToIso(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null;
  const micros = Number(value);
  if (!Number.isFinite(micros) || micros <= 0) return null;
  const unixMs = Math.round(micros / 1000 - 11644473600000);
  const date = new Date(unixMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function parseChromiumBookmarks(
  file: ChromiumBookmarkFile,
  options: { browser: BrowserBookmarkProvider; profile: string; syncedAt: string },
): BrowserBookmarkRecord[] {
  const records: BrowserBookmarkRecord[] = [];

  const visit = (node: ChromiumNode, folderPath: string[]) => {
    if (node.type === 'url' && node.url) {
      const sourceItemId = node.id ?? `${node.url}:${folderPath.join('/')}`;
      records.push({
        id: `${options.browser}:${options.profile}:${sourceItemId}`,
        browser: options.browser,
        profile: options.profile,
        sourceItemId,
        url: node.url,
        title: node.name || node.url,
        folderPath,
        dateAdded: chromiumWebkitTimeToIso(node.date_added),
        dateModified: chromiumWebkitTimeToIso(node.date_modified),
        syncedAt: options.syncedAt,
      });
      return;
    }

    if (node.type === 'folder') {
      const nextPath = node.name ? [...folderPath, node.name] : folderPath;
      for (const child of node.children ?? []) visit(child, nextPath);
    }
  };

  for (const root of Object.values(file.roots ?? {})) visit(root, []);
  return records;
}

export async function syncBrowserBookmarks(options: SyncBrowserBookmarksOptions): Promise<BrowserBookmarkSyncResult> {
  const { browser, profile, bookmarksPath } = options;
  if (browser === 'safari') {
    throw new Error('Safari bookmark sync is not supported yet');
  }
  if (browser !== 'chrome' && browser !== 'vivaldi') {
    throw new Error(`Unsupported browser bookmark provider: ${browser}`);
  }
  if (!bookmarksPath) {
    throw new Error(`--bookmarks-file is required to sync ${browser} bookmarks in this first cut`);
  }

  const syncedAt = new Date().toISOString();
  const cachePath = browserBookmarksCachePath(browser, profile);
  const metaPath = browserBookmarksMetaPath(browser, profile);
  const snapshotPath = path.join(os.tmpdir(), `fieldtheory-bookmarks-${randomUUID()}.json`);

  try {
    await copyFile(bookmarksPath, snapshotPath);
    const parsed = JSON.parse(await readFile(snapshotPath, 'utf8')) as ChromiumBookmarkFile;
    const records = parseChromiumBookmarks(parsed, { browser, profile, syncedAt });

    await mkdir(path.dirname(cachePath), { recursive: true });
    await mkdir(path.dirname(metaPath), { recursive: true });
    await writeJsonLines(cachePath, records);
    await writeJson(metaPath, {
      browser,
      profile,
      sourcePath: bookmarksPath,
      cachePath,
      synced: records.length,
      syncedAt,
    });

    if (options.rebuildCanonical) {
      await rebuildCanonicalIndex({ browserSources: [{ browser, profile }] });
    }

    return { browser, profile, synced: records.length, cachePath };
  } finally {
    await rm(snapshotPath, { force: true }).catch(() => undefined);
  }
}
