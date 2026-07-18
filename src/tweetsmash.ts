/**
 * Tweetsmash enrichment connector.
 *
 * Layers Tweetsmash's REST data (bookmark import timestamps, labels, read
 * state) onto GraphQL-synced X bookmark records. Tweetsmash is enrichment,
 * not a source of truth: records are matched by tweet id and only gain
 * fields the GraphQL sync cannot provide.
 *
 * Rate limit is 100 requests/hour; a rate-limited crawl persists its cursor
 * and the next run resumes. A crawl that completes clears the cursor so a
 * stale tail position can never pin later runs (see the sync tail-cursor
 * deadlock fixed in 3a2d016).
 */
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
  totalStored?: number;
}

interface TweetsmashPageResponse {
  status: boolean;
  data: TweetsmashPost[];
  message?: string | null;
  meta: { next_cursor?: string | null; limit?: number };
}

export class TweetsmashRateLimitError extends Error {
  constructor() {
    super('Tweetsmash API rate limited (429); progress saved, rerun to resume.');
  }
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
  if (response.status === 429) throw new TweetsmashRateLimitError();
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
  totalStored: number;
  pages: number;
  complete: boolean;
}

export interface TweetsmashSyncOptions {
  maxPages?: number;
  rebuild?: boolean;
  fetchImpl?: typeof fetch;
}

export async function syncTweetsmash(options: TweetsmashSyncOptions = {}): Promise<TweetsmashSyncResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxPages = options.maxPages ?? Number.POSITIVE_INFINITY;
  await ensureDir(tweetsmashDir());

  const meta: TweetsmashMeta = (await pathExists(tweetsmashMetaPath()))
    ? await readJson<TweetsmashMeta>(tweetsmashMetaPath())
    : {};
  const stored = new Map<string, TweetsmashPost>();
  if (!options.rebuild && (await pathExists(tweetsmashCachePath()))) {
    for (const post of await readJsonLines<TweetsmashPost>(tweetsmashCachePath())) {
      stored.set(post.post_id, post);
    }
  }
  const knownBefore = new Set(stored.keys());

  let cursor = options.rebuild ? undefined : meta.resumeCursor;
  const resuming = Boolean(cursor);
  let pages = 0;
  let fetched = 0;
  let newPosts = 0;
  let complete = false;
  let rateLimited = false;

  while (pages < maxPages) {
    let page: TweetsmashPageResponse;
    try {
      page = await fetchPage(cursor, fetchImpl);
    } catch (error) {
      if (error instanceof TweetsmashRateLimitError) {
        rateLimited = true;
        break;
      }
      throw error;
    }
    pages += 1;
    fetched += page.data.length;
    let pageNew = 0;
    for (const post of page.data) {
      if (!stored.has(post.post_id)) pageNew += 1;
      stored.set(post.post_id, post);
    }
    newPosts += pageNew;
    cursor = page.meta.next_cursor ?? undefined;
    if (!cursor) {
      complete = true;
      break;
    }
    // Incremental stop: a fresh (non-resumed) crawl that hits a full page of
    // already-known posts has reached previously synced territory.
    if (!resuming && !options.rebuild && pageNew === 0 && knownBefore.size > 0) {
      complete = true;
      break;
    }
  }

  await writeJsonLines(tweetsmashCachePath(), [...stored.values()]);
  await writeJson(tweetsmashMetaPath(), {
    lastRunAt: new Date().toISOString(),
    // Completion (or a plain page-capped stop with nothing pending) clears the
    // cursor; only a rate-limited stop keeps a resume position.
    ...(rateLimited && cursor ? { resumeCursor: cursor } : {}),
    totalStored: stored.size,
  } satisfies TweetsmashMeta);

  return { fetched, newPosts, totalStored: stored.size, pages, complete };
}

export interface TweetsmashApplyResult {
  matched: number;
  datesSet: number;
  tagsMerged: number;
  flagged: number;
  burstSkipped: number;
}

/**
 * Merge stored Tweetsmash data into the main X bookmark records.
 * - bookmarkedAt: set from imported_at only when missing AND the post is not
 *   part of the initial historical-import burst (whose imported_at is just
 *   the Tweetsmash signup time).
 * - tags: union of existing tags and Tweetsmash labels.
 * - read/archived state: stored as tweetsmashRead / tweetsmashArchived.
 */
export async function applyTweetsmashEnrichment(): Promise<TweetsmashApplyResult> {
  const result: TweetsmashApplyResult = { matched: 0, datesSet: 0, tagsMerged: 0, flagged: 0, burstSkipped: 0 };
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
        result.datesSet += 1;
        changed = true;
      } else {
        result.burstSkipped += 1;
      }
    }

    if (post.tags?.length) {
      const merged = [...new Set([...(record.tags ?? []), ...post.tags])];
      if (merged.length !== (record.tags?.length ?? 0)) {
        record.tags = merged;
        result.tagsMerged += 1;
        changed = true;
      }
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
    `  ✓ Tweetsmash: ${sync.newPosts} new post(s), ${sync.totalStored} stored (${sync.pages} page(s)${sync.complete ? '' : ', resumable'})`,
    `    enriched: ${apply.matched} matched · ${apply.datesSet} bookmark dates set · ${apply.tagsMerged} tag merges · ${apply.burstSkipped} initial-burst dates skipped`,
  ];
  return lines.join('\n');
}
