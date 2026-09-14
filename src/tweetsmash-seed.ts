/**
 * Seed Tweetsmash labels from Raindrop tags.
 *
 * Raindrop carries a rich topic taxonomy for X saves; Tweetsmash labels are
 * mostly empty. This pushes Raindrop tags onto the matching Tweetsmash posts
 * so labels are visible (and filterable) inside Tweetsmash itself.
 *
 * Budget: the API allows 100 requests/hour, so writes go one request per
 * label chunk (not per tweet). Each successful chunk is mirrored into the
 * local Tweetsmash cache immediately, which makes reruns skip finished work.
 */
import { pathExists, readJsonLines, writeJsonLines } from './fs.js';
import { raindropBookmarksCachePath } from './raindrop/paths.js';
import type { RaindropRecord } from './raindrop/types.js';
import {
  DEFAULT_RATE_LIMIT_WAIT_MS,
  MAX_RATE_LIMIT_WAITS,
  TWEETSMASH_BASE_URL,
  TweetsmashRateLimitError,
  parseRetryAfter,
  tweetsmashApiKey,
  tweetsmashCachePath,
  type TweetsmashPost,
} from './tweetsmash.js';
import { xStatusIdFromUrl } from './url-normalize.js';

/** Raindrop bookkeeping tags that are not topics. */
const NON_TOPIC_TAGS = new Set(['x-bookmark', 'synced', 'misc', 'unavailable', 'pixel-9a']);
const DEFAULT_MIN_COUNT = 100;
const CHUNK_SIZE = 250;

export interface SeedLabelPlan {
  label: string;
  /** Tweetsmash posts carrying this Raindrop tag. */
  total: number;
  /** Tweet ids still missing the label in Tweetsmash. */
  pending: string[];
}

export interface SeedOptions {
  minCount?: number;
  dryRun?: boolean;
  waitOnRateLimit?: boolean;
  maxRequests?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (event: { label: string; added: number; pending: number }) => void;
  onRateLimitWait?: (info: { waitMs: number; attempt: number }) => void;
}

export interface SeedResult {
  plan: Array<{ label: string; total: number; pending: number }>;
  requests: number;
  assigned: number;
  rateLimited: boolean;
  complete: boolean;
}

export async function planTweetsmashSeedFromRaindrop(minCount = DEFAULT_MIN_COUNT): Promise<{
  plans: SeedLabelPlan[];
  posts: TweetsmashPost[];
}> {
  if (!(await pathExists(tweetsmashCachePath()))) {
    throw new Error('No Tweetsmash cache yet; run `ft sync-tweetsmash` first.');
  }
  if (!(await pathExists(raindropBookmarksCachePath()))) {
    throw new Error('No Raindrop cache yet; run `ft sync-raindrop` first.');
  }
  const posts = await readJsonLines<TweetsmashPost>(tweetsmashCachePath());
  const byId = new Map(posts.map((post) => [post.post_id, post]));

  const idsByLabel = new Map<string, Set<string>>();
  for (const record of await readJsonLines<RaindropRecord>(raindropBookmarksCachePath())) {
    const tweetId = xStatusIdFromUrl(record.url);
    if (!tweetId || !byId.has(tweetId)) continue;
    for (const raw of record.tags ?? []) {
      const label = raw.trim();
      if (!label || NON_TOPIC_TAGS.has(label.toLowerCase())) continue;
      const ids = idsByLabel.get(label) ?? new Set<string>();
      ids.add(tweetId);
      idsByLabel.set(label, ids);
    }
  }

  const plans = [...idsByLabel.entries()]
    .filter(([, ids]) => ids.size >= minCount)
    .map(([label, ids]) => ({
      label,
      total: ids.size,
      pending: [...ids].filter((id) => !hasLabel(byId.get(id)!, label)),
    }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  return { plans, posts };
}

export async function seedTweetsmashLabelsFromRaindrop(options: SeedOptions = {}): Promise<SeedResult> {
  const { plans, posts } = await planTweetsmashSeedFromRaindrop(options.minCount);
  const summary = plans.map((plan) => ({ label: plan.label, total: plan.total, pending: plan.pending.length }));
  const result: SeedResult = { plan: summary, requests: 0, assigned: 0, rateLimited: false, complete: false };
  if (options.dryRun) return result;

  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxRequests = options.maxRequests ?? Number.POSITIVE_INFINITY;
  const byId = new Map(posts.map((post) => [post.post_id, post]));
  let waits = 0;

  outer: for (const plan of plans) {
    for (let offset = 0; offset < plan.pending.length; ) {
      if (result.requests >= maxRequests) break outer;
      const chunk = plan.pending.slice(offset, offset + CHUNK_SIZE);
      try {
        result.requests += 1;
        await addLabel(plan.label, chunk, fetchImpl);
      } catch (error) {
        if (!(error instanceof TweetsmashRateLimitError)) {
          await writeJsonLines(tweetsmashCachePath(), posts);
          throw error;
        }
        if (options.waitOnRateLimit && waits < MAX_RATE_LIMIT_WAITS) {
          waits += 1;
          await writeJsonLines(tweetsmashCachePath(), posts);
          const waitMs = error.retryAfterMs ?? DEFAULT_RATE_LIMIT_WAIT_MS;
          options.onRateLimitWait?.({ waitMs, attempt: waits });
          await sleep(waitMs);
          continue;
        }
        result.rateLimited = true;
        break outer;
      }
      for (const id of chunk) {
        const post = byId.get(id)!;
        post.tags = [...(post.tags ?? []), plan.label];
      }
      result.assigned += chunk.length;
      offset += chunk.length;
      options.onProgress?.({ label: plan.label, added: offset, pending: plan.pending.length });
      // Persist per chunk so an interrupted run never re-sends finished work.
      await writeJsonLines(tweetsmashCachePath(), posts);
    }
  }

  result.complete = !result.rateLimited && result.assigned === summary.reduce((sum, plan) => sum + plan.pending, 0);
  return result;
}

async function addLabel(label: string, tweetIds: string[], fetchImpl: typeof fetch): Promise<void> {
  const response = await fetchImpl(new URL(`${TWEETSMASH_BASE_URL}/labels/add`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${tweetsmashApiKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tweet_ids: tweetIds, label_name: label }),
  });
  if (response.status === 429) throw new TweetsmashRateLimitError(parseRetryAfter(response.headers.get('retry-after')));
  if (response.status === 401) throw new Error('Tweetsmash API returned 401: invalid TWEETSMASH_API_KEY.');
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new Error(`Tweetsmash label add ${response.status} for "${label}": ${text}`);
  const body = text ? (JSON.parse(text) as { status?: boolean; message?: string }) : {};
  if (body.status === false) throw new Error(`Tweetsmash label add failed for "${label}": ${body.message ?? 'unknown error'}`);
}

function hasLabel(post: TweetsmashPost, label: string): boolean {
  const key = label.toLowerCase();
  return (post.tags ?? []).some((tag) => tag.trim().toLowerCase() === key);
}
