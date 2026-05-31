import { mkdir } from 'node:fs/promises';
import { readJson, readJsonLines, writeJson, writeJsonLines } from '../fs.js';
import { pathExists } from '../fs.js';
import type {
  RaindropBackfillState,
  RaindropBookmark,
  RaindropCollection,
  RaindropMeta,
  RaindropRecord,
} from './types.js';
import {
  fetchCollections,
  fetchRaindropsPage,
} from './client.js';
import {
  raindropBackfillStatePath,
  raindropBookmarksCachePath,
  raindropMetaPath,
} from './paths.js';

export interface SyncRaindropOptions {
  rebuild?: boolean;
  full?: boolean;
  collections?: number[];
  dryRun?: boolean;
  perPage?: number;
  limit?: number;
}

export interface SyncRaindropResult {
  total: number;
  newCount: number;
  modifiedCount: number;
  collections: number;
  cachePath: string;
}

function normalizeRaindropBookmark(
  raw: RaindropBookmark,
  collectionMap: Map<number, string[]>,
): RaindropRecord | null {
  if (!raw._id || !raw.link) {
    // Skip malformed bookmarks without required fields
    return null;
  }

  const collectionId =
    typeof raw.collection === 'object' && raw.collection !== null
      ? '$id' in raw.collection
        ? raw.collection.$id
        : (raw.collection as RaindropCollection)._id
      : undefined;

  const links: string[] = [];
  if (raw.domain) links.push(`https://${raw.domain}`);
  if (raw.media?.length) {
    for (const m of raw.media) {
      if (m.link) links.push(m.link);
    }
  }

  const collectionPath = collectionId ? collectionMap.get(collectionId) : undefined;

  return {
    id: raw._id,
    url: raw.link,
    title: raw.title,
    excerpt: raw.excerpt || undefined,
    note: raw.note || undefined,
    highlights: raw.highlights?.length ? raw.highlights : undefined,
    tags: raw.tags?.length ? raw.tags : undefined,
    collectionId: collectionId ?? undefined,
    collectionName: collectionPath?.at(-1),
    collectionPath,
    createdAt: raw.created,
    updatedAt: raw.lastUpdate || raw.created,
    type: raw.type || undefined,
    cover: raw.cover || undefined,
    domain: raw.domain || undefined,
    important: raw.important ?? undefined,
    mediaCount: raw.media?.length || 0,
    links: [...new Set(links)],
    syncedAt: new Date().toISOString(),
  };
}

function mergeRaindropRecord(
  existing: RaindropRecord,
  incoming: RaindropRecord,
): RaindropRecord {
  const existingUpdated = existing.updatedAt || existing.createdAt;
  const incomingUpdated = incoming.updatedAt || incoming.createdAt;
  const preferIncoming = incomingUpdated >= existingUpdated;

  const base = preferIncoming ? incoming : existing;

  // Merge arrays uniquely
  const mergedTags = [...new Set([...(existing.tags ?? []), ...(incoming.tags ?? [])])];
  const mergedHighlights = [...(existing.highlights ?? [])];
  for (const h of incoming.highlights ?? []) {
    if (!mergedHighlights.some((eh) => eh._id === h._id)) {
      mergedHighlights.push(h);
    }
  }

  // Determine if anything material changed beyond just syncedAt
  const materiallyChanged =
    base.title !== existing.title ||
    base.excerpt !== existing.excerpt ||
    base.note !== existing.note ||
    base.collectionPath?.join('/') !== existing.collectionPath?.join('/') ||
    mergedTags.join(',') !== (existing.tags ?? []).join(',') ||
    mergedHighlights.length !== (existing.highlights ?? []).length ||
    base.updatedAt !== existing.updatedAt;

  return {
    ...base,
    tags: mergedTags.length ? mergedTags : undefined,
    highlights: mergedHighlights.length ? mergedHighlights : undefined,
    syncedAt: materiallyChanged ? incoming.syncedAt : existing.syncedAt,
  };
}

function buildCollectionMap(
  collections: RaindropCollection[],
): Map<number, string[]> {
  const map = new Map<number, RaindropCollection>();
  for (const c of collections) {
    map.set(c._id, c);
  }

  function resolvePath(id: number, visited = new Set<number>()): string[] {
    if (visited.has(id)) return []; // break cycles
    const c = map.get(id);
    if (!c) return [];
    const parentId = c.parent?.$id;
    if (parentId) {
      visited.add(id);
      return [...resolvePath(parentId, visited), c.title];
    }
    return [c.title];
  }

  const pathMap = new Map<number, string[]>();
  for (const c of collections) {
    pathMap.set(c._id, resolvePath(c._id));
  }
  return pathMap;
}

const MAX_PAGES = 10_000; // safety guard against runaway pagination

export async function syncRaindropBookmarks(
  options: SyncRaindropOptions = {},
): Promise<SyncRaindropResult> {
  const {
    rebuild = false,
    full = false,
    dryRun = false,
    perPage = 50,
  } = options;

  const cachePath = raindropBookmarksCachePath();
  const metaPath = raindropMetaPath();
  const statePath = raindropBackfillStatePath();

  let existingRecords = new Map<number, RaindropRecord>();
  let state: RaindropBackfillState = {};

  if (!rebuild) {
    if (await pathExists(cachePath)) {
      const records = await readJsonLines<RaindropRecord>(cachePath);
      for (const r of records) existingRecords.set(r.id, r);
    }
    if (await pathExists(statePath)) {
      try {
        state = await readJson<RaindropBackfillState>(statePath);
      } catch {
        state = {};
      }
    }
  }

  // Fetch collections
  const collectionsResponse = await fetchCollections();
  const collectionMap = buildCollectionMap(collectionsResponse.items);

  // Determine starting page:
  // --rebuild or --full → start from page 0
  // completed previous sync → start from page 0 (re-fetch to find new items)
  // incomplete previous sync → resume from lastPageFetched + 1
  const wasIncomplete = state.completed === false && typeof state.lastPageFetched === 'number';
  const startPage = (rebuild || full || !wasIncomplete) ? 0 : state.lastPageFetched! + 1;

  const collectionIds = options.collections?.length
    ? options.collections
    : [0]; // 0 = "All" collection

  let totalFetched = 0;
  let newCount = 0;
  let modifiedCount = 0;

  for (const collectionId of collectionIds) {
    let currentPage = startPage;
    let hasMore = true;
    let pagesThisCollection = 0;

    while (hasMore) {
      if (pagesThisCollection >= MAX_PAGES) {
        console.warn(`  Warning: reached max page limit (${MAX_PAGES}) for collection ${collectionId}. Stopping pagination.`);
        break;
      }

      const response = await fetchRaindropsPage(collectionId, currentPage, perPage);
      if (!response.result) {
        throw new Error(`Raindrop API returned result: false for collection ${collectionId} page ${currentPage}`);
      }

      const items = response.items ?? [];
      totalFetched += items.length;

      for (const raw of items) {
        const normalized = normalizeRaindropBookmark(raw, collectionMap);
        if (!normalized) continue; // skip malformed
        const existing = existingRecords.get(normalized.id);
        if (!existing) {
          newCount += 1;
          existingRecords.set(normalized.id, normalized);
        } else {
          const merged = mergeRaindropRecord(existing, normalized);
          if (merged.updatedAt !== existing.updatedAt || merged.syncedAt !== existing.syncedAt) {
            modifiedCount += 1;
          }
          existingRecords.set(normalized.id, merged);
        }
      }

      hasMore = items.length === perPage;
      currentPage += 1;
      pagesThisCollection += 1;

      if (options.limit && totalFetched >= options.limit) {
        hasMore = false;
      }

      // Write incremental state after each page for crash recovery
      if (!dryRun) {
        const incrementalState: RaindropBackfillState = {
          lastPageFetched: currentPage - 1,
          perPage,
          completed: false,
        };
        await writeJson(statePath, incrementalState);
      }
    }
  }

  if (dryRun) {
    return {
      total: totalFetched,
      newCount,
      modifiedCount,
      collections: collectionMap.size,
      cachePath,
    };
  }

  // Write cache
  const sortedRecords = [...existingRecords.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  await mkdir(cachePath.replace(/\/bookmarks\.jsonl$/, ''), { recursive: true });
  await writeJsonLines(cachePath, sortedRecords);

  // Write meta
  const meta: RaindropMeta = {
    lastSyncedAt: new Date().toISOString(),
    syncedCount: sortedRecords.length,
    collectionsSyncedAt: new Date().toISOString(),
    collectionMap: Object.fromEntries(
      [...collectionMap.entries()].map(([id, path]) => [
        id,
        { title: path[path.length - 1] ?? '', path },
      ]),
    ),
  };
  await writeJson(metaPath, meta);

  // Write final completed state
  const newState: RaindropBackfillState = {
    lastPageFetched: 0,
    perPage,
    completed: true,
    completedAt: new Date().toISOString(),
  };
  await writeJson(statePath, newState);

  return {
    total: totalFetched,
    newCount,
    modifiedCount,
    collections: collectionMap.size,
    cachePath,
  };
}
