/**
 * Following roster sync orchestration: fetch from GraphQL, upsert into JSONL,
 * rebuild the SQLite index, and optionally classify.
 */

import { ensureFollowingDir } from './paths.js';
import { followingCachePath, followingMetaPath } from './paths.js';
import { readJsonLines, writeJsonLines, readJson, writeJson, pathExists } from '../fs.js';
import { fetchFollowing, parseUserIdFromTwid, resolveBrowserSession } from './fetch.js';
import { buildFollowingIndex } from './db.js';
import type { FollowingRecord, FollowingSyncOptions, FollowingSyncResult, FollowingSyncProgress } from './types.js';
import type { FollowingMeta } from './types.js';

/**
 * Merge incoming following records with existing JSONL, upserting by userId.
 * Preserves classification fields from existing records when the incoming
 * record doesn't carry them.
 */
export function mergeFollowingRecords(
  existing: FollowingRecord[],
  incoming: FollowingRecord[],
): { merged: FollowingRecord[]; added: number } {
  const byId = new Map(existing.map((r) => [r.userId, r]));
  let added = 0;

  for (const record of incoming) {
    const prev = byId.get(record.userId);
    if (!prev) {
      added += 1;
      byId.set(record.userId, record);
    } else {
      // Upsert: update profile fields, preserve classification if incoming lacks it
      byId.set(record.userId, {
        ...prev,
        ...record,
        domains: record.domains ?? prev.domains,
        primaryDomain: record.primaryDomain ?? prev.primaryDomain,
        expertise: record.expertise ?? prev.expertise,
        expertiseSummary: record.expertiseSummary ?? prev.expertiseSummary,
        bookmarkOverlap: record.bookmarkOverlap ?? prev.bookmarkOverlap,
      });
    }
  }

  // Sort by handle for stable ordering
  const merged = Array.from(byId.values()).sort((a, b) => a.handle.localeCompare(b.handle));
  return { merged, added };
}

export async function syncFollowing(options: FollowingSyncOptions = {}): Promise<FollowingSyncResult> {
  ensureFollowingDir();
  const cachePath = followingCachePath();
  const metaPath = followingMetaPath();

  // Load existing records
  const existing = await readJsonLines<FollowingRecord>(cachePath);

  // Load previous meta for cursor
  let previousMeta: FollowingMeta | undefined;
  if (await pathExists(metaPath)) {
    previousMeta = await readJson<FollowingMeta>(metaPath);
  }

  // Cursor: a full re-crawl ignores it; otherwise resume from the saved cursor
  // (an interrupted run's bottom cursor; `--continue` and default are the same resume).
  const cursor = options.rebuild ? undefined : previousMeta?.cursor;

  // Resolve the browser session ONCE here, then hand the cookies to fetchFollowing
  // so cookies (and any Keychain prompt) are only extracted a single time.
  const session = resolveBrowserSession(options);
  const viewerId = parseUserIdFromTwid(session.cookieHeader) ?? previousMeta?.viewerId;

  if (!viewerId) {
    throw new Error(
      'Could not determine your X user ID from the twid cookie.\n' +
      'Make sure you are logged into x.com in your browser and that the twid cookie is present.\n' +
      'You can also pass --cookies <ct0> <auth_token> with a valid session.'
    );
  }

  const maxMinutes = options.maxMinutes ?? 30;
  const deadline = maxMinutes !== Infinity ? Date.now() + maxMinutes * 60_000 : undefined;

  let lastProgress: FollowingSyncProgress = { page: 0, totalFetched: 0, newAdded: 0, running: true, done: false };
  options.onProgress?.(lastProgress);

  const fetchResult = await fetchFollowing({
    userId: viewerId,
    cursor,
    maxPages: options.maxPages ?? Infinity,
    deadline,
    delayMs: options.delayMs,
    queryId: options.queryId,
    csrfToken: session.csrfToken,
    cookieHeader: session.cookieHeader,
  });

  // Merge results
  const { merged, added } = mergeFollowingRecords(existing, fetchResult.records);

  // Write JSONL
  await writeJsonLines(cachePath, merged);

  // Write meta
  const now = new Date().toISOString();
  const isTerminal = fetchResult.stopReason === 'end of following';
  const meta: FollowingMeta = {
    cursor: isTerminal ? undefined : fetchResult.nextCursor,
    lastUpdated: now,
    count: merged.length,
    viewerId,
  };
  await writeJson(metaPath, meta);

  // Rebuild index
  const indexResult = await buildFollowingIndex();

  lastProgress = {
    page: fetchResult.pages,
    totalFetched: fetchResult.records.length,
    newAdded: added,
    running: false,
    done: true,
    stopReason: fetchResult.stopReason,
  };
  options.onProgress?.(lastProgress);

  return {
    added,
    totalFollowing: merged.length,
    pages: fetchResult.pages,
    stopReason: fetchResult.stopReason,
    cachePath,
    metaPath,
  };
}
