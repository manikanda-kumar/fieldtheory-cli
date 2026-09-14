/**
 * Tweetsmash enrichment connector.
 *
 * Layers Tweetsmash's REST data (bookmark import timestamps, labels, read
 * state) onto GraphQL-synced X bookmark records. Tweetsmash is enrichment,
 * not a source of truth: records are matched by tweet id and only gain
 * fields the GraphQL sync cannot provide.
 *
 * Rate limit is 100 requests/hour; a rate-limited crawl persists its cursor
 * and the next run resumes (or, with waitOnRateLimit, sleeps and continues).
 * A full rebuild (~120 pages) spans windows, so it keeps the cache and its
 * cursor until the archive walk finishes. A crawl that completes clears the cursor so a
 * stale tail position can never pin later runs (see the sync tail-cursor
 * deadlock fixed in 3a2d016).
 */
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { ensureDir, pathExists, readJson, readJsonLines, writeJson, writeJsonLines } from './fs.js';
import { dataDir, twitterBookmarksCachePath } from './paths.js';
import type { BookmarkRecord } from './types.js';

const BASE_URL = 'https://api.tweetsmash.com/v1';
const PAGE_LIMIT = 100;
/**
 * Records imported within this window of the account's earliest import are
 * treated as the initial historical backfill burst: their imported_at is the
 * Tweetsmash signup import time, not a real bookmark time.
 */
const INITIAL_IMPORT_BURST_MS = 48 * 60 * 60 * 1000;

export interface TweetsmashPost {
  post_id: string;
  imported_at: string;
  tags: string[];
  is_read: boolean;
  is_archived: boolean;
  tweet_details?: { text?: string; link?: string; posted_at?: string };
  author_username?: string;
}

export interface TweetsmashMeta {
  lastRunAt?: string;
  /** Persisted only when a crawl stopped early (rate limit); cleared on completion. */
  resumeCursor?: string;
  /**
   * Set while a full refetch spans several rate-limit windows. Later runs
   * continue from resumeCursor instead of restarting the archive walk.
   */
  rebuildStartedAt?: string;
  totalStored?: number;
}

interface TweetsmashPageResponse {
  status: boolean;
  data: TweetsmashPost[];
  message?: string | null;
  meta: { next_cursor?: string | null; limit?: number };
}

export class TweetsmashRateLimitError extends Error {
  constructor(readonly retryAfterMs?: number) {
    super('Tweetsmash API rate limited (429); progress saved, rerun to resume.');
  }
}

/** Fallback wait when a 429 carries no Retry-After; the limit is 100 requests/hour. */
const DEFAULT_RATE_LIMIT_WAIT_MS = 10 * 60 * 1000;
const MAX_RATE_LIMIT_WAITS = 12;

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
}

export function tweetsmashDir(): string {
  return path.join(dataDir(), 'tweetsmash');
}

export function tweetsmashCachePath(): string {
  return path.join(tweetsmashDir(), 'bookmarks.jsonl');
}

export function tweetsmashMetaPath(): string {
  return path.join(tweetsmashDir(), 'meta.json');
}

/** Post ids fetched by the in-progress rebuild, used to prune posts gone from Tweetsmash. */
export function tweetsmashRebuildSeenPath(): string {
  return path.join(tweetsmashDir(), 'rebuild-seen.json');
}

function apiKey(): string {
  const key = process.env.TWEETSMASH_API_KEY?.trim();
  if (!key) throw new Error('TWEETSMASH_API_KEY environment variable is not set.');
  return key;
}

async function fetchPage(cursor: string | undefined, fetchImpl: typeof fetch): Promise<TweetsmashPageResponse> {
  const url = new URL(`${BASE_URL}/bookmarks`);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (response.status === 429) throw new TweetsmashRateLimitError(parseRetryAfter(response.headers.get('retry-after')));
  if (response.status === 401) throw new Error('Tweetsmash API returned 401: invalid TWEETSMASH_API_KEY.');
  if (!response.ok) throw new Error(`Tweetsmash API ${response.status}: ${await response.text().catch(() => '')}`);
  const body = (await response.json()) as TweetsmashPageResponse;
  if (!body.status || !Array.isArray(body.data)) {
    throw new Error(`Tweetsmash API returned an unexpected payload${body.message ? `: ${body.message}` : ''}.`);
  }
  return body;
}

/** Tweetsmash timestamps are naive UTC with microseconds; normalize to ISO Z. */
export function normalizeImportedAt(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const candidate = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`;
  const ms = Date.parse(candidate);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export interface TweetsmashSyncResult {
  fetched: number;
  newPosts: number;
  updatedPosts: number;
  /** Cached posts dropped because a completed rebuild no longer saw them. */
  pruned: number;
  totalStored: number;
  pages: number;
  complete: boolean;
  rateLimited: boolean;
  /** True while a multi-run full refetch still has pages left. */
  rebuildPending: boolean;
}

export interface TweetsmashSyncOptions {
  maxPages?: number;
  rebuild?: boolean;
  /** Sleep through 429s and keep crawling instead of stopping with a saved cursor. */
  waitOnRateLimit?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRateLimitWait?: (info: { waitMs: number; pages: number; attempt: number }) => void;
}

export async function syncTweetsmash(options: TweetsmashSyncOptions = {}): Promise<TweetsmashSyncResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  await ensureDir(tweetsmashDir());

  const meta: TweetsmashMeta = (await pathExists(tweetsmashMetaPath()))
    ? await readJson<TweetsmashMeta>(tweetsmashMetaPath())
    : {};
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // A rebuild never discards the cache up front: a full archive walk takes
  // more than one hourly rate-limit window, and an early stop must not leave
  // enrichment with a partial post set. Refetched pages overwrite in place.
  const stored = new Map<string, TweetsmashPost>();
  if (await pathExists(tweetsmashCachePath())) {
    for (const post of await readJsonLines<TweetsmashPost>(tweetsmashCachePath())) {
      stored.set(post.post_id, post);
    }
  }
  const knownBefore = new Set(stored.keys());

  // Continue an unfinished rebuild whether or not --rebuild is repeated; a new
  // --rebuild only restarts from the top when none is pending.
  const continuingRebuild = Boolean(meta.rebuildStartedAt && meta.resumeCursor);
  const rebuilding = continuingRebuild || Boolean(options.rebuild);
  const rebuildStartedAt = continuingRebuild ? meta.rebuildStartedAt : options.rebuild ? new Date().toISOString() : undefined;
  let cursor = continuingRebuild || !options.rebuild ? meta.resumeCursor : undefined;
  const resuming = Boolean(cursor);
  // Seen ids only prove absence when the walk began at the top under this
  // tracking; a continued rebuild without the file skips pruning.
  let rebuildSeen: Set<string> | null = null;
  if (rebuilding) {
    if (!continuingRebuild) rebuildSeen = new Set();
    else if (await pathExists(tweetsmashRebuildSeenPath())) {
      rebuildSeen = new Set(await readJson<string[]>(tweetsmashRebuildSeenPath()));
    }
  }
  let pruned = 0;
  let pages = 0;
  let fetched = 0;
  let newPosts = 0;
  let updatedPosts = 0;
  let complete = false;
  let rateLimited = false;
  let waits = 0;

  const persist = async (stoppedByRateLimit = rateLimited) => {
    // Rebuilds keep their cursor on any early stop (page cap, 429, error) so
    // chunked runs make progress; incremental crawls keep it only on 429.
    const keepCursor = !complete && Boolean(cursor) && (rebuilding || stoppedByRateLimit);
    if (rebuilding && keepCursor && rebuildSeen) {
      await writeJson(tweetsmashRebuildSeenPath(), [...rebuildSeen]);
    } else if (await pathExists(tweetsmashRebuildSeenPath())) {
      await rm(tweetsmashRebuildSeenPath(), { force: true });
    }
    await writeJsonLines(tweetsmashCachePath(), [...stored.values()]);
    await writeJson(tweetsmashMetaPath(), {
      lastRunAt: new Date().toISOString(),
      ...(keepCursor ? { resumeCursor: cursor } : {}),
      ...(keepCursor && rebuilding ? { rebuildStartedAt } : {}),
      totalStored: stored.size,
    } satisfies TweetsmashMeta);
  };

  try {
    while (pages < maxPages) {
      let page: TweetsmashPageResponse;
      try {
        page = await fetchPage(cursor, fetchImpl);
      } catch (error) {
        if (!(error instanceof TweetsmashRateLimitError)) throw error;
        if (options.waitOnRateLimit && waits < MAX_RATE_LIMIT_WAITS) {
          waits += 1;
          // Save before sleeping so an interrupted wait loses nothing.
          await persist(true);
          const waitMs = error.retryAfterMs ?? DEFAULT_RATE_LIMIT_WAIT_MS;
          options.onRateLimitWait?.({ waitMs, pages, attempt: waits });
          await sleep(waitMs);
          continue;
        }
        rateLimited = true;
        break;
      }
      pages += 1;
      fetched += page.data.length;
      let pageNew = 0;
      let pageUpdated = 0;
      for (const post of page.data) {
        const existing = stored.get(post.post_id);
        if (!existing) pageNew += 1;
        else if (JSON.stringify(existing) !== JSON.stringify(post)) pageUpdated += 1;
        stored.set(post.post_id, post);
        rebuildSeen?.add(post.post_id);
      }
      newPosts += pageNew;
      updatedPosts += pageUpdated;
      cursor = page.meta.next_cursor ?? undefined;
      if (!cursor) {
        complete = true;
        if (rebuildSeen && rebuildSeen.size > 0) {
          for (const id of [...stored.keys()]) {
            if (!rebuildSeen.has(id)) {
              stored.delete(id);
              pruned += 1;
            }
          }
        }
        break;
      }
      // Incremental stop: a fresh (non-resumed) crawl that hits a full page of
      // already-known posts has reached previously synced territory.
      if (!resuming && !rebuilding && pageNew === 0 && pageUpdated === 0 && knownBefore.size > 0) {
        complete = true;
        break;
      }
    }
  } finally {
    await persist();
  }

  return {
    fetched,
    newPosts,
    updatedPosts,
    pruned,
    totalStored: stored.size,
    pages,
    complete,
    rateLimited,
    rebuildPending: rebuilding && !complete && Boolean(cursor),
  };
}

export interface TweetsmashApplyResult {
  matched: number;
  datesSet: number;
  tagsUpdated: number;
  flagged: number;
  burstSkipped: number;
}

/**
 * Merge stored Tweetsmash data into the main X bookmark records.
 * - bookmarkedAt: set from imported_at only when missing AND the post is not
 *   part of the initial historical-import burst (whose imported_at is just
 *   the Tweetsmash signup time).
 * - tags: mirror current Tweetsmash labels while preserving tags owned by
 *   other importers.
 * - read/archived state: stored as tweetsmashRead / tweetsmashArchived.
 */
export async function applyTweetsmashEnrichment(): Promise<TweetsmashApplyResult> {
  const result: TweetsmashApplyResult = { matched: 0, datesSet: 0, tagsUpdated: 0, flagged: 0, burstSkipped: 0 };
  if (!(await pathExists(tweetsmashCachePath())) || !(await pathExists(twitterBookmarksCachePath()))) {
    return result;
  }
  const posts = await readJsonLines<TweetsmashPost>(tweetsmashCachePath());
  if (posts.length === 0) return result;

  const importedMs = posts
    .map((post) => Date.parse(normalizeImportedAt(post.imported_at) ?? ''))
    .filter((ms) => Number.isFinite(ms));
  const burstEndMs = importedMs.length > 0 ? Math.min(...importedMs) + INITIAL_IMPORT_BURST_MS : Number.NEGATIVE_INFINITY;

  const byTweetId = new Map(posts.map((post) => [post.post_id, post]));
  // Records enriched before ownership tracking carry Tweetsmash labels only in
  // `tags`. Adopt tags matching a known Tweetsmash label so removals mirror.
  const tweetsmashLabelKeys = new Set(posts.flatMap((post) => normalizeTags(post.tags ?? []).map((tag) => tag.toLowerCase())));
  const records = await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath());
  let changed = false;

  for (const record of records) {
    const post = byTweetId.get(record.tweetId);
    if (!post) continue;
    result.matched += 1;

    const importedAt = normalizeImportedAt(post.imported_at);
    if (record.bookmarkedAt == null && importedAt) {
      if (Date.parse(importedAt) > burstEndMs) {
        record.bookmarkedAt = importedAt;
        // Mark provenance so sanitizeBookmarkedAt doesn't null this on the
        // next sync (graphql-ingested records normally never carry dates).
        record.bookmarkedAtSource = 'tweetsmash';
        result.datesSet += 1;
        changed = true;
      } else {
        result.burstSkipped += 1;
      }
    }

    const previousTweetsmashTags = record.tweetsmashTags
      ? normalizeTags(record.tweetsmashTags)
      : normalizeTags(record.tags ?? []).filter((tag) => tweetsmashLabelKeys.has(tag.toLowerCase()));
    const nextTweetsmashTags = normalizeTags(post.tags ?? []);
    const previousKeys = new Set(previousTweetsmashTags.map((tag) => tag.toLowerCase()));
    const otherTags = normalizeTags(record.tags ?? []).filter((tag) => !previousKeys.has(tag.toLowerCase()));
    const nextTags = normalizeTags([...otherTags, ...nextTweetsmashTags]);
    const adoptOwnership = !record.tweetsmashTags && nextTweetsmashTags.length > 0;
    if (adoptOwnership || !sameTags(record.tags ?? [], nextTags) || !sameTags(previousTweetsmashTags, nextTweetsmashTags)) {
      record.tags = nextTags;
      record.tweetsmashTags = nextTweetsmashTags;
      result.tagsUpdated += 1;
      changed = true;
    }

    const flags = record as BookmarkRecord & { tweetsmashRead?: boolean; tweetsmashArchived?: boolean };
    if (flags.tweetsmashRead !== post.is_read || flags.tweetsmashArchived !== post.is_archived) {
      flags.tweetsmashRead = post.is_read;
      flags.tweetsmashArchived = post.is_archived;
      result.flagged += 1;
      changed = true;
    }
  }

  if (changed) await writeJsonLines(twitterBookmarksCachePath(), records);
  return result;
}

export function formatTweetsmashResult(sync: TweetsmashSyncResult, apply: TweetsmashApplyResult): string {
  const lines = [
    `  ✓ Tweetsmash: ${sync.newPosts} new post(s), ${sync.updatedPosts} updated, ${sync.pruned ? `${sync.pruned} pruned, ` : ''}${sync.totalStored} stored (${sync.pages} page(s)${sync.rebuildPending ? ', rebuild pending' : sync.complete ? '' : ', resumable'})`,
    `    enriched: ${apply.matched} matched · ${apply.datesSet} bookmark dates set · ${apply.tagsUpdated} tag updates · ${apply.burstSkipped} initial-burst dates skipped`,
  ];
  return lines.join('\n');
}

function normalizeTags(tags: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const raw of tags) {
    const tag = raw.trim();
    if (tag && !byKey.has(tag.toLowerCase())) byKey.set(tag.toLowerCase(), tag);
  }
  return [...byKey.values()];
}

function sameTags(left: string[], right: string[]): boolean {
  const normalizedLeft = normalizeTags(left);
  return normalizedLeft.length === right.length
    && normalizedLeft.every((tag, index) => tag === right[index]);
}
