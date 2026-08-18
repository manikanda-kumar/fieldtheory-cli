/**
 * Raindrop-only X saves carry no readable content: Raindrop's scraper cannot
 * see past x.com's auth wall, so it stores the tweet id as the title and leaves
 * the excerpt empty. Those rows rendered in the daily digest as a bare number
 * with no description (live 2026-08-17: 3.6k such saves).
 *
 * A tweet that is also an X bookmark folds into the rich record at index time
 * (see `rebuildCanonicalIndex`). The rest need their own fetch, which this
 * module does once per tweet and caches as JSONL beside the Raindrop cache.
 */
import { createTweetFetcher, type SyncGapsOptions, type TweetFetcher } from '../graphql-bookmarks.js';
import { ensureDir, readJsonLines, writeJsonLines, pathExists } from '../fs.js';
import { twitterBookmarksCachePath } from '../paths.js';
import type { BookmarkRecord } from '../types.js';
import { xStatusIdFromUrl } from '../url-normalize.js';
import { raindropBookmarksDir, raindropBookmarksCachePath, raindropXHydrationPath } from './paths.js';
import type { RaindropRecord } from './types.js';

export interface RaindropXHydration {
  tweetId: string;
  status: 'ok' | 'not_found' | 'forbidden' | 'empty' | 'rate_limited' | 'server_error' | 'error';
  fetchedAt: string;
  authorHandle?: string;
  authorName?: string;
  text?: string;
  postedAt?: string | null;
  url?: string;
}

/** Outcomes that will never improve on a retry, so the id is not re-fetched. */
const PERMANENT_STATUSES = new Set<RaindropXHydration['status']>(['ok', 'not_found', 'forbidden', 'empty']);

/** Cache writes rewrite the whole file, so batch them during long backfills. */
const FLUSH_EVERY = 25;

/**
 * Raindrop's placeholder title for an unscrapable tweet: the tweet id itself.
 * An empty title counts too, and so does the `x.com/i/article/…` stub Raindrop
 * writes for X Articles.
 */
export function isPlaceholderXTitle(title: string | null | undefined, tweetId: string): boolean {
  const trimmed = (title ?? '').trim();
  if (!trimmed) return true;
  if (trimmed === tweetId) return true;
  if (/^\d{6,}$/.test(trimmed)) return true;
  return /^(https?:\/\/)?(www\.)?(x|twitter)\.com\/\S*$/i.test(trimmed);
}

export async function readRaindropXHydration(): Promise<Map<string, RaindropXHydration>> {
  const filePath = raindropXHydrationPath();
  if (!await pathExists(filePath)) return new Map();
  const rows = await readJsonLines<RaindropXHydration>(filePath);
  // Later rows win: a retry that finally succeeded must beat the failure.
  return new Map(rows.filter((row) => row?.tweetId).map((row) => [row.tweetId, row]));
}

export interface RaindropXCandidate {
  tweetId: string;
  url: string;
  raindropId: number;
}

/**
 * Tweet ids that still need a fetch: Raindrop X saves with a placeholder title,
 * no matching X bookmark, and no settled hydration attempt.
 */
export function raindropXHydrationCandidates(
  records: RaindropRecord[],
  hydration: Map<string, RaindropXHydration>,
  xBookmarkTweetIds: Set<string>,
): RaindropXCandidate[] {
  const seen = new Set<string>();
  const candidates: RaindropXCandidate[] = [];
  for (const record of records) {
    const tweetId = xStatusIdFromUrl(record.url);
    if (!tweetId || seen.has(tweetId)) continue;
    if (xBookmarkTweetIds.has(tweetId)) continue;
    if (!isPlaceholderXTitle(record.title, tweetId) && record.excerpt) continue;
    const settled = hydration.get(tweetId);
    if (settled && PERMANENT_STATUSES.has(settled.status)) continue;
    seen.add(tweetId);
    candidates.push({ tweetId, url: record.url, raindropId: record.id });
  }
  return candidates;
}

export interface HydrateRaindropXOptions extends Omit<SyncGapsOptions, 'onProgress'> {
  /** Max tweets to fetch this run; the rest stay queued for the next one. */
  limit?: number;
  /** Report progress without writing the hydration cache. */
  dryRun?: boolean;
  onProgress?: (progress: { done: number; total: number; tweetId: string }) => void;
}

export interface HydrateRaindropXResult {
  candidates: number;
  attempted: number;
  hydrated: number;
  failed: number;
  /**
   * Candidates the next run will still see: the ones this run's limit skipped
   * plus the transient failures (rate limits, network) that stay retryable.
   */
  remaining: number;
}

export async function hydrateRaindropXBookmarks(
  options: HydrateRaindropXOptions = {},
): Promise<HydrateRaindropXResult> {
  const delayMs = options.delayMs ?? 300;
  const records = await readJsonLines<RaindropRecord>(raindropBookmarksCachePath());
  const xRecords = await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath());
  const xBookmarkTweetIds = new Set(xRecords.map((record) => record.tweetId).filter(Boolean));
  const hydration = await readRaindropXHydration();
  const candidates = raindropXHydrationCandidates(records, hydration, xBookmarkTweetIds);

  const limit = options.limit && options.limit > 0 ? options.limit : candidates.length;
  const batch = candidates.slice(0, limit);
  const result: HydrateRaindropXResult = {
    candidates: candidates.length,
    attempted: 0,
    hydrated: 0,
    failed: 0,
    remaining: candidates.length - batch.length,
  };
  if (options.dryRun || batch.length === 0) return result;

  const { onProgress: _progress, limit: _limit, dryRun: _dryRun, ...fetchOptions } = options;
  const fetcher: TweetFetcher = createTweetFetcher(fetchOptions);
  for (let index = 0; index < batch.length; index++) {
    const { tweetId } = batch[index];
    const fetchedAt = new Date().toISOString();
    let row: RaindropXHydration;
    try {
      const fetched = await fetcher(tweetId);
      const snapshot = fetched.snapshot;
      // An X Article carries its body outside the tweet text; keep both so the
      // digest has something to summarize either way.
      const articleText = fetched.article?.text?.trim() || undefined;
      const text = [snapshot?.text?.trim(), articleText].filter(Boolean).join('\n\n') || undefined;
      row = text
        ? {
          tweetId,
          status: 'ok',
          fetchedAt,
          authorHandle: snapshot?.authorHandle,
          authorName: snapshot?.authorName,
          text,
          postedAt: snapshot?.postedAt ?? null,
          url: snapshot?.url,
        }
        : { tweetId, status: fetched.status === 'ok' ? 'empty' : fetched.status, fetchedAt };
    } catch {
      row = { tweetId, status: 'error', fetchedAt };
    }

    hydration.set(tweetId, row);
    result.attempted++;
    if (row.status === 'ok') result.hydrated++;
    else result.failed++;
    // A transient failure is not settled, so it re-enters the queue next run.
    if (!PERMANENT_STATUSES.has(row.status)) result.remaining++;
    options.onProgress?.({ done: index + 1, total: batch.length, tweetId });

    // Persist periodically: a long backfill interrupted halfway keeps its work
    // without rewriting the whole cache after every single fetch.
    if ((index + 1) % FLUSH_EVERY === 0) await flush(hydration);
    if (delayMs > 0 && index < batch.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  await flush(hydration);

  return result;
}

/** Rewrite the hydration cache from the in-memory map (latest row per tweet). */
async function flush(hydration: Map<string, RaindropXHydration>): Promise<void> {
  await ensureDir(raindropBookmarksDir());
  await writeJsonLines(raindropXHydrationPath(), [...hydration.values()], { mode: 0o600 });
}
