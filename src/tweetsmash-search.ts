/**
 * Live Tweetsmash search overlay.
 *
 * Local FTS5 stays the source of truth. This calls GET /v1/bookmarks with
 * keyword (`q`) plus semantic (`vector_search_term`) so paraphrases that
 * miss BM25 can still surface. Soft-fail: no key, 429, 401, or network
 * error returns an empty result instead of breaking search.
 *
 * Not used by `ft serve` Library keystrokes — 100 req/hour is too tight
 * for typeahead. Opt in on `ft search`, `ft research`, and `ft ask`.
 */
import type { SearchResult } from './bookmarks-db.js';

const BASE_URL = 'https://api.tweetsmash.com/v1';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_LIMIT = 10;
const USER_AGENT = 'FieldTheory/1.0 (+https://fieldtheory.dev/cli)';

export interface TweetsmashSearchHit {
  postId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  tags: string[];
}

export interface TweetsmashSearchResult {
  hits: TweetsmashSearchHit[];
  skipped: boolean;
  reason?: string;
}

export interface TweetsmashSearchOptions {
  query: string;
  limit?: number;
  author?: string;
  after?: string;
  before?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  apiKey?: string | null;
}

interface TweetsmashTweetDetails {
  text?: string;
  link?: string;
  posted_at?: string;
}

interface TweetsmashAuthorDetails {
  name?: string;
  username?: string;
}

interface TweetsmashSearchPost {
  post_id?: string;
  tags?: string[] | null;
  author_username?: string;
  author_details?: TweetsmashAuthorDetails | null;
  tweet_details?: TweetsmashTweetDetails | null;
}

interface TweetsmashSearchResponse {
  status?: boolean;
  data?: TweetsmashSearchPost[];
  message?: string | null;
}

export function tweetsmashApiKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env.TWEETSMASH_API_KEY?.trim();
  return key || undefined;
}

export function tweetIdFromStatusUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  const match = url.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
  return match?.[1] ?? null;
}

export function tweetsmashHitToSearchResult(hit: TweetsmashSearchHit): SearchResult {
  return {
    id: hit.postId,
    url: hit.url,
    text: hit.text,
    authorHandle: hit.authorHandle,
    authorName: hit.authorName,
    postedAt: hit.postedAt,
    score: 0,
  };
}

function skipped(reason: string): TweetsmashSearchResult {
  return { hits: [], skipped: true, reason };
}

function compactText(value: string | undefined | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function statusUrl(post: TweetsmashSearchPost): string {
  const link = post.tweet_details?.link?.trim();
  if (link) return link;
  const handle = post.author_username || post.author_details?.username || 'i';
  return `https://x.com/${handle}/status/${post.post_id ?? ''}`;
}

function mapPost(post: TweetsmashSearchPost): TweetsmashSearchHit | null {
  const postId = post.post_id?.trim();
  if (!postId) return null;
  const handle = post.author_username || post.author_details?.username || undefined;
  return {
    postId,
    url: statusUrl(post),
    text: compactText(post.tweet_details?.text) || `(tweet ${postId})`,
    authorHandle: handle,
    authorName: post.author_details?.name || undefined,
    postedAt: post.tweet_details?.posted_at ?? null,
    tags: Array.isArray(post.tags) ? post.tags.filter(Boolean) : [],
  };
}

function dateBound(value: string | undefined, endOfDay: boolean): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return endOfDay ? `${value}T23:59:59Z` : `${value}T00:00:00Z`;
  }
  return value;
}

export function mergeLocalAndTweetsmashHits<T extends { id: string }>(
  local: T[],
  remote: TweetsmashSearchHit[],
  mapRemote: (hit: TweetsmashSearchHit) => T,
  limit: number,
  localIds?: ReadonlySet<string>,
  reserveRemote = 5,
): T[] {
  const seen = new Set<string>(localIds);
  for (const hit of local) seen.add(hit.id);

  const extras: T[] = [];
  const extraCap = Math.min(Math.max(reserveRemote, 0), limit);
  for (const hit of remote) {
    if (seen.has(hit.postId)) continue;
    seen.add(hit.postId);
    extras.push(mapRemote(hit));
    if (extras.length >= extraCap) break;
  }

  const localKeep = Math.max(limit - extras.length, 0);
  return [...local.slice(0, localKeep), ...extras];
}

export async function searchTweetsmashBookmarks(
  options: TweetsmashSearchOptions,
): Promise<TweetsmashSearchResult> {
  const query = options.query.trim();
  if (!query) return skipped('empty-query');

  const apiKey = options.apiKey === undefined ? tweetsmashApiKey() : options.apiKey?.trim() || null;
  if (!apiKey) return skipped('no-api-key');

  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 100);
  const url = new URL(`${BASE_URL}/bookmarks`);
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('q', query);
  url.searchParams.set('vector_search_term', query);
  if (options.author) url.searchParams.set('author', options.author.replace(/^@/, ''));
  const postedFrom = dateBound(options.after, false);
  const postedTo = dateBound(options.before, true);
  if (postedFrom) url.searchParams.set('posted_from', postedFrom);
  if (postedTo) url.searchParams.set('posted_to', postedTo);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
    if (response.status === 429) return skipped('rate-limited');
    if (response.status === 401 || response.status === 403) return skipped('unauthorized');
    if (!response.ok) return skipped(`http-${response.status}`);

    const body = (await response.json()) as TweetsmashSearchResponse;
    if (!body.status || !Array.isArray(body.data)) return skipped('bad-payload');

    return {
      hits: body.data.map(mapPost).filter((hit): hit is TweetsmashSearchHit => hit !== null),
      skipped: false,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return skipped('timeout');
    return skipped('network');
  } finally {
    clearTimeout(timeout);
  }
}
