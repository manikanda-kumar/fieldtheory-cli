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

/** Keep only accounts observed during the named crawl, preserving their merged classification. */
export function pruneToFollowingCrawl(records: FollowingRecord[], crawlStartedAt: string): FollowingRecord[] {
  return records.filter((record) => record.seenInCrawlAt === crawlStartedAt);
}

/** A full crawl that loses half the roster is more likely malformed than real. */
const MIN_RETAINED_SNAPSHOT_FRACTION = 0.5;

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

  // Imported list members and old pre-snapshot caches cannot be distinguished
  // from actual follows. Require one explicit authoritative crawl before any
  // dependent consumer is allowed to treat this roster as Following.
  const isLegacyCache = existing.length > 0 && previousMeta?.snapshotComplete === undefined;
  if (isLegacyCache && !options.rebuild) {
    throw new Error(
      'Following roster predates authoritative snapshots. Run `ft sync-following --rebuild` once to establish a complete roster.'
    );
  }

  const nowFn = options.now ?? (() => new Date());
  const canResume = !options.rebuild
    && previousMeta?.snapshotComplete === false
    && Boolean(previousMeta.cursor)
    && Boolean(previousMeta.crawlStartedAt);
  const crawlStartedAt = canResume ? previousMeta!.crawlStartedAt! : nowFn().toISOString();
  // A completed roster always starts at the top. Only an explicitly incomplete
  // crawl with a saved cursor can resume.
  const cursor = canResume ? previousMeta!.cursor : undefined;

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
    fetchImpl: options.fetchImpl,
    now: () => nowFn().toISOString(),
  });

  // A failed/rate-limited first request has not changed the roster. Preserve
  // the last known complete metadata so its consumers remain available.
  if (fetchResult.pages === 0 && fetchResult.records.length === 0 && fetchResult.stopReason !== 'end of following') {
    lastProgress = {
      page: fetchResult.pages,
      totalFetched: 0,
      newAdded: 0,
      running: false,
      done: true,
      stopReason: fetchResult.stopReason,
    };
    options.onProgress?.(lastProgress);
    return {
      added: 0,
      totalFollowing: existing.length,
      pages: fetchResult.pages,
      stopReason: fetchResult.stopReason,
      cachePath,
      metaPath,
      snapshotComplete: previousMeta?.snapshotComplete === true,
      pruned: 0,
    };
  }

  // Merge results
  const observed = fetchResult.records.map((record) => ({ ...record, seenInCrawlAt: crawlStartedAt }));
  const { merged, added } = mergeFollowingRecords(existing, observed);
  const terminalResponse = fetchResult.stopReason === 'end of following';
  const seenThisCrawl = pruneToFollowingCrawl(merged, crawlStartedAt);
  const suspiciousEmpty = terminalResponse && existing.length > 0 && seenThisCrawl.length === 0;
  const implausibleShrink = terminalResponse
    && !options.rebuild
    && existing.length > 0
    && seenThisCrawl.length < existing.length * MIN_RETAINED_SNAPSHOT_FRACTION;
  const snapshotGuarded = suspiciousEmpty || implausibleShrink;
  const isTerminal = terminalResponse && !snapshotGuarded;
  const finalRecords = isTerminal ? seenThisCrawl : merged;
  const pruned = merged.length - finalRecords.length;
  const stopReason = implausibleShrink
    ? 'implausible shrink guard'
    : suspiciousEmpty
      ? 'suspicious empty crawl'
      : fetchResult.stopReason;
  const now = nowFn().toISOString();

  // Only after fetchFollowing has returned do we mark a changed, incomplete
  // crawl as such. A first-page exception or rate limit therefore leaves the
  // previous complete snapshot usable.
  if (!isTerminal) {
    await writeJson(metaPath, {
      cursor: fetchResult.nextCursor,
      lastUpdated: now,
      count: finalRecords.length,
      viewerId,
      snapshotComplete: false,
      ...(fetchResult.nextCursor ? { crawlStartedAt } : {}),
    } satisfies FollowingMeta);
  }

  // Write JSONL
  await writeJsonLines(cachePath, finalRecords);

  // Write meta
  const meta: FollowingMeta = {
    cursor: isTerminal ? undefined : fetchResult.nextCursor,
    lastUpdated: now,
    count: finalRecords.length,
    viewerId,
    snapshotComplete: isTerminal && !suspiciousEmpty,
    ...(!isTerminal && fetchResult.nextCursor ? { crawlStartedAt } : {}),
  };
  await writeJson(metaPath, meta);

  // Rebuild index
  await buildFollowingIndex();

  lastProgress = {
    page: fetchResult.pages,
    totalFetched: fetchResult.records.length,
    newAdded: added,
    running: false,
    done: true,
    stopReason,
  };
  options.onProgress?.(lastProgress);

  return {
    added,
    totalFollowing: finalRecords.length,
    pages: fetchResult.pages,
    stopReason,
    cachePath,
    metaPath,
    snapshotComplete: meta.snapshotComplete === true,
    pruned,
  };
}
