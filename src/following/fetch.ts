/**
 * GraphQL fetch for the logged-in user's X/Twitter following list.
 *
 * Uses the same browser session cookie auth path as `ft sync` (graphql-bookmarks.ts).
 * Two GraphQL calls:
 *   1. The `twid` cookie (extracted alongside ct0/auth_token) encodes the viewer's
 *      user ID as URL-encoded JSON `"u=<id>"`.
 *   2. The `Following` operation paginates through the accounts the viewer follows.
 *
 * Query ID is configurable via `--query-id` because X changes it with bundle updates.
 * The default is sourced from twscrape's maintained operation list (June 2026).
 */

import { loadChromeSessionConfig } from '../config.js';
import { extractChromeXCookies } from '../chrome-cookies.js';
import { extractFirefoxXCookies } from '../firefox-cookies.js';
import type { FollowingRecord } from './types.js';

const X_PUBLIC_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

/** Default query ID for the Following operation (from twscrape, June 2026). */
export const FOLLOWING_QUERY_ID = 'OLm4oHZBfqWx8jbcEhWoFw';
const FOLLOWING_OPERATION = 'Following';

const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

const FOLLOWING_FEATURES: Record<string, boolean> = {
  articles_preview_enabled: false,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  verified_phone_label_enabled: false,
  view_counts_everywhere_api_enabled: true,
};

export interface FetchFollowingOptions {
  userId: string;
  count?: number;
  cursor?: string;
  maxPages?: number;
  delayMs?: number;
  queryId?: string;
  browser?: string;
  chromeUserDataDir?: string;
  chromeProfileDirectory?: string;
  firefoxProfileDir?: string;
  csrfToken?: string;
  cookieHeader?: string;
  /** Wall-clock epoch ms after which the fetch loop stops between pages. */
  deadline?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests. */
  now?: () => string;
}

export interface FollowingPageResult {
  records: FollowingRecord[];
  nextCursor?: string;
}

/** Parse the `twid` cookie value to extract the viewer's numeric user ID. */
export function parseUserIdFromTwid(cookieHeader: string): string | null {
  const match = cookieHeader.match(/twid=([^;]+)/);
  if (!match) return null;
  const raw = match[1];
  try {
    const decoded = decodeURIComponent(raw);
    // Format: "u=<userId>" (JSON-encoded string)
    const idMatch = decoded.match(/u%3D(\d+)/) || decoded.match(/u=(\d+)/);
    if (idMatch) return idMatch[1];
    // Some browsers store it as raw u=<id> without quotes
    const directMatch = decoded.match(/^"?u=(\d+)"?$/);
    if (directMatch) return directMatch[1];
    return null;
  } catch {
    return null;
  }
}

export interface BrowserSessionOptions {
  browser?: string;
  chromeUserDataDir?: string;
  chromeProfileDirectory?: string;
  firefoxProfileDir?: string;
  csrfToken?: string;
  cookieHeader?: string;
}

/**
 * Resolve the X session (csrf token + cookie header) from an explicit override
 * or by extracting browser cookies. Exported so the sync orchestrator can
 * resolve once and reuse, avoiding a second cookie extraction (Keychain prompt).
 */
export function resolveBrowserSession(options: BrowserSessionOptions): { csrfToken: string; cookieHeader: string } {
  if (options.csrfToken) {
    return { csrfToken: options.csrfToken, cookieHeader: options.cookieHeader ?? `ct0=${options.csrfToken}` };
  }
  const config = loadChromeSessionConfig({ browserId: options.browser });
  if (config.browser.cookieBackend === 'firefox') {
    return extractFirefoxXCookies(options.firefoxProfileDir);
  }
  const chromeDir = options.chromeUserDataDir ?? config.chromeUserDataDir;
  const chromeProfile = options.chromeProfileDirectory ?? config.chromeProfileDirectory;
  return extractChromeXCookies(chromeDir, chromeProfile, config.browser);
}

function buildHeaders(csrfToken: string, cookieHeader: string): Record<string, string> {
  return {
    authorization: `Bearer ${X_PUBLIC_BEARER}`,
    'x-csrf-token': csrfToken,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'content-type': 'application/json',
    'user-agent': CHROME_UA,
    cookie: cookieHeader,
  };
}

function buildFollowingUrl(userId: string, queryId: string, count: number, cursor?: string): string {
  const variables: Record<string, unknown> = {
    userId,
    count,
    includePromotedContent: false,
  };
  if (cursor) variables.cursor = cursor;
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(FOLLOWING_FEATURES),
  });
  return `https://x.com/i/api/graphql/${queryId}/${FOLLOWING_OPERATION}?${params}`;
}

/**
 * Convert a raw GraphQL user_results.result into a FollowingRecord.
 * Handles both the TimelineAddEntries item shape and the nested items array
 * used by some X response variants.
 */
export function convertUserResultToFollowing(result: any, now: string): FollowingRecord | null {
  if (!result || typeof result !== 'object') return null;

  // X sometimes wraps user in a tombstone/unavailable type
  const typename = result.__typename;
  if (typename === 'UserUnavailable') return null;

  const legacy = result.legacy;
  const restId = result.rest_id;
  if (!restId || !legacy) return null;

  const handle = legacy.screen_name;
  if (!handle) return null;

  return {
    userId: String(restId),
    handle,
    name: legacy.name ?? '',
    bio: legacy.description ?? undefined,
    profileImageUrl: result.avatar?.image_url ?? legacy.profile_image_url_https ?? legacy.profile_image_url,
    followerCount: legacy.followers_count,
    followingCount: legacy.friends_count,
    verified: Boolean(result.is_blue_verified ?? legacy.verified),
    syncedAt: now,
  };
}

/**
 * Parse a Following GraphQL response page into records + next cursor.
 * Response path: data.user.result.timeline.timeline.instructions
 */
export function parseFollowingResponse(json: any, now?: string): FollowingPageResult {
  const ts = now ?? new Date().toISOString();

  const userResult = json?.data?.user?.result;
  const instructions = userResult?.timeline?.timeline?.instructions ?? [];

  const entries: any[] = [];
  for (const inst of instructions) {
    if (inst.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) {
      entries.push(...inst.entries);
    }
  }

  const records: FollowingRecord[] = [];
  let nextCursor: string | undefined;

  for (const entry of entries) {
    if (typeof entry.entryId === 'string' && entry.entryId.startsWith('cursor-bottom')) {
      nextCursor = entry.content?.value;
      continue;
    }

    // Single-user item: content.itemContent.user_results.result
    const singleResult = entry?.content?.itemContent?.user_results?.result;
    if (singleResult) {
      const record = convertUserResultToFollowing(singleResult, ts);
      if (record) records.push(record);
      continue;
    }

    // Multi-user module: content.items[].item.itemContent.user_results.result
    const items = entry?.content?.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        const nestedResult = item?.item?.itemContent?.user_results?.result;
        if (nestedResult) {
          const record = convertUserResultToFollowing(nestedResult, ts);
          if (record) records.push(record);
        }
      }
    }
  }

  return { records, nextCursor };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch all (or a page-limited subset of) the logged-in user's following list.
 *
 * Returns the raw records and pagination stats. The caller (sync.ts) handles
 * upsert into JSONL and DB.
 */
export async function fetchFollowing(options: FetchFollowingOptions): Promise<{
  records: FollowingRecord[];
  pages: number;
  stopReason: string;
  nextCursor?: string;
}> {
  const userId = options.userId;
  const count = options.count ?? 100;
  const queryId = options.queryId ?? FOLLOWING_QUERY_ID;
  const delayMs = options.delayMs ?? 600;
  const maxPages = options.maxPages ?? Infinity;
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowFn = options.now ?? (() => new Date().toISOString());

  const session = resolveBrowserSession(options);
  const headers = buildHeaders(session.csrfToken, session.cookieHeader);
  const deadline = options.deadline;

  const allRecords = new Map<string, FollowingRecord>();
  let cursor = options.cursor;
  let pages = 0;
  let stopReason = 'max-pages';

  for (let page = 0; page < maxPages; page += 1) {
    if (deadline && Date.now() > deadline) {
      stopReason = 'time limit';
      break;
    }
    const url = buildFollowingUrl(userId, queryId, count, cursor);
    const response = await fetchImpl(url, { headers });
    const text = await response.text();

    if (response.status === 429) {
      stopReason = 'rate limited';
      break;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `X Following API returned ${response.status}.\n` +
        'Your X session may have expired. Open your browser, go to https://x.com, ' +
        'and make sure you are logged in. Then retry.'
      );
    }
    if (!response.ok) {
      throw new Error(`X Following API returned ${response.status}: ${text.slice(0, 500)}`);
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`X returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    const parsed = parseFollowingResponse(json, nowFn());
    pages += 1;

    for (const record of parsed.records) {
      allRecords.set(record.userId, record);
    }

    // A page with no users means the timeline is exhausted, even if X still
    // hands back a cursor — stop rather than spin through empty pages.
    if (parsed.records.length === 0 || !parsed.nextCursor) {
      stopReason = 'end of following';
      break;
    }

    cursor = parsed.nextCursor;

    if (page < maxPages - 1 && delayMs > 0) await sleep(delayMs);
  }

  return {
    records: Array.from(allRecords.values()),
    pages,
    stopReason,
    nextCursor: cursor,
  };
}
