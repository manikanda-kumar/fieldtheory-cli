/**
 * Sync X list *members* (roster), not timeline tweets.
 *
 * Uses GraphQL ListMembers (query id from twscrape, mid-2026) with the same
 * Chrome/Firefox cookie session as `ft x-list` / `ft sync-following`.
 *
 * Writes:
 *   ~/.fieldtheory/x-lists/<listId>-members.json
 *   ~/.fieldtheory/x-lists/<listId>-members-latest.json  (complete snapshots only)
 *
 * List membership is intentionally independent from the user's Following
 * roster. An account is only marked followed when X's Following crawl returns
 * it for the logged-in user.
 */

import path from 'node:path';
import { ensureXListsDir } from './paths.js';
import { pathExists, readJson, writeJson } from './fs.js';
import {
  convertUserResultToFollowing,
  resolveBrowserSession,
  type BrowserSessionOptions,
} from './following/fetch.js';
import { parseListId } from './x-list-fetch.js';

const X_PUBLIC_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

/** Default ListMembers operation id (twscrape, mid-2026). Overridable via --query-id. */
export const LIST_MEMBERS_QUERY_ID = 'kcsJubZ1BIwpdKrYfiNRtg';
const LIST_MEMBERS_OPERATION = 'ListMembers';

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

const LIST_MEMBERS_FEATURES: Record<string, boolean> = {
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

export interface ListMemberRecord {
  userId: string;
  handle: string;
  name: string;
  bio?: string;
  profileImageUrl?: string;
  followerCount?: number;
  followingCount?: number;
  verified?: boolean;
  syncedAt: string;
}

export interface XListMembersDigest {
  listId: string;
  fetchedAt: string;
  members: ListMemberRecord[];
  stats: {
    count: number;
    pagesFetched: number;
    stopReason: string;
    nextCursor?: string;
    /** True only after X returned a page with no bottom cursor. */
    snapshotComplete: boolean;
  };
}

export interface FetchXListMembersOptions extends BrowserSessionOptions {
  listId: string;
  count?: number;
  maxPages?: number;
  delayMs?: number;
  queryId?: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
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

function buildListMembersUrl(listId: string, queryId: string, count: number, cursor?: string): string {
  const variables: Record<string, unknown> = { listId, count };
  if (cursor) variables.cursor = cursor;
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(LIST_MEMBERS_FEATURES),
  });
  return `https://x.com/i/api/graphql/${queryId}/${LIST_MEMBERS_OPERATION}?${params}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse a ListMembers GraphQL page. Primary path:
 *   data.list.members_timeline.timeline.instructions
 * Fallbacks walk any TimelineAddEntries instructions in the payload.
 */
export function parseListMembersResponse(json: any, now?: string): {
  records: ListMemberRecord[];
  nextCursor?: string;
} {
  const ts = now ?? new Date().toISOString();
  const instructions =
    json?.data?.list?.members_timeline?.timeline?.instructions ??
    json?.data?.list?.timeline?.timeline?.instructions ??
    [];

  const entries: any[] = [];
  for (const inst of instructions) {
    if (inst?.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) {
      entries.push(...inst.entries);
    }
  }

  // Fallback: deep-scan for TimelineAddEntries if primary path empty
  if (entries.length === 0) {
    const stack = [json];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object') continue;
      if (cur.type === 'TimelineAddEntries' && Array.isArray(cur.entries)) {
        entries.push(...cur.entries);
      }
      for (const v of Object.values(cur)) {
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  }

  const records: ListMemberRecord[] = [];
  let nextCursor: string | undefined;

  for (const entry of entries) {
    if (typeof entry.entryId === 'string' && entry.entryId.startsWith('cursor-bottom')) {
      nextCursor = entry.content?.value ?? entry.content?.itemContent?.value;
      continue;
    }
    if (typeof entry.entryId === 'string' && entry.entryId.startsWith('cursor-')) {
      if (entry.content?.cursorType === 'Bottom') {
        nextCursor = entry.content?.value;
      }
      continue;
    }

    const single = entry?.content?.itemContent?.user_results?.result;
    if (single) {
      const rec = convertUserResultToFollowing(single, ts);
      if (rec) records.push(rec);
      continue;
    }

    const items = entry?.content?.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        const nested =
          item?.item?.itemContent?.user_results?.result ??
          item?.itemContent?.user_results?.result;
        if (nested) {
          const rec = convertUserResultToFollowing(nested, ts);
          if (rec) records.push(rec);
        }
      }
    }
  }

  return { records, nextCursor };
}

export async function fetchXListMembers(options: FetchXListMembersOptions): Promise<XListMembersDigest> {
  const listId = parseListId(options.listId);
  const count = options.count ?? 100;
  const queryId = options.queryId ?? LIST_MEMBERS_QUERY_ID;
  const delayMs = options.delayMs ?? 600;
  const maxPages = options.maxPages ?? 200;
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowFn = options.now ?? (() => new Date().toISOString());

  const session = resolveBrowserSession(options);
  const headers = buildHeaders(session.csrfToken, session.cookieHeader);

  const byId = new Map<string, ListMemberRecord>();
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  let consecutiveEmptyPages = 0;
  let pages = 0;
  let stopReason = 'max-pages';
  const maxConsecutiveEmptyPages = 2;

  for (let page = 0; page < maxPages; page += 1) {
    const url = buildListMembersUrl(listId, queryId, count, cursor);
    const response = await fetchImpl(url, { headers });
    const text = await response.text();

    if (response.status === 429) {
      stopReason = 'rate limited';
      break;
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        `X ListMembers API returned ${response.status}.\n` +
          'Your X session may have expired. Open https://x.com, log in, then retry.'
      );
    }
    if (!response.ok) {
      throw new Error(`X ListMembers API returned ${response.status}: ${text.slice(0, 500)}`);
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`X returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`);
    }

    // GraphQL soft errors (invalid query id, etc.)
    if (Array.isArray(json?.errors) && json.errors.length && !json?.data?.list) {
      const msg = json.errors.map((e: any) => e?.message ?? JSON.stringify(e)).join('; ');
      throw new Error(
        `X ListMembers GraphQL error: ${msg}\n` +
          'Try updating --query-id if X rotated the ListMembers operation id.'
      );
    }

    const parsed = parseListMembersResponse(json, nowFn());
    pages += 1;
    for (const r of parsed.records) byId.set(r.userId, r);

    if (!parsed.nextCursor) {
      stopReason = 'end of members';
      break;
    }

    cursor = parsed.nextCursor;
    if (seenCursors.has(cursor)) {
      stopReason = 'cursor cycle';
      break;
    }
    seenCursors.add(cursor);

    if (parsed.records.length === 0) {
      consecutiveEmptyPages += 1;
      if (consecutiveEmptyPages >= maxConsecutiveEmptyPages) {
        stopReason = 'too many empty pages';
        break;
      }
    } else {
      consecutiveEmptyPages = 0;
    }

    if (page < maxPages - 1 && delayMs > 0) await sleep(delayMs);
  }

  const members = Array.from(byId.values()).sort((a, b) =>
    a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' })
  );

  return {
    listId,
    fetchedAt: nowFn(),
    members,
    stats: {
      count: members.length,
      pagesFetched: pages,
      stopReason,
      nextCursor: cursor,
      snapshotComplete: stopReason === 'end of members',
    },
  };
}

export function membersStorePaths(listId: string): {
  dir: string;
  stamped: (fetchedAt: string) => string;
  latest: string;
} {
  const dir = ensureXListsDir();
  return {
    dir,
    stamped: (fetchedAt: string) => {
      const stamp = fetchedAt.slice(0, 19).replace(/[:T]/g, '-');
      return path.join(dir, `${listId}-members-${stamp}.json`);
    },
    latest: path.join(dir, `${listId}-members-latest.json`),
  };
}

export async function writeListMembersDigest(digest: XListMembersDigest): Promise<{
  jsonPath: string;
  latestPath: string;
  latestStatus: 'updated' | 'preserved' | 'unavailable';
}> {
  const paths = membersStorePaths(digest.listId);
  const jsonPath = paths.stamped(digest.fetchedAt);
  // Keep every attempt for diagnosis, but only a complete crawl is allowed to
  // advance the stable roster consumed by the canonical index.
  await writeJson(jsonPath, digest);
  if (digest.stats.snapshotComplete) {
    await writeJson(paths.latest, digest);
    return { jsonPath, latestPath: paths.latest, latestStatus: 'updated' };
  }
  return {
    jsonPath,
    latestPath: paths.latest,
    latestStatus: await hasCompleteLatestSnapshot(paths.latest) ? 'preserved' : 'unavailable',
  };
}

async function hasCompleteLatestSnapshot(latestPath: string): Promise<boolean> {
  if (!(await pathExists(latestPath))) return false;
  try {
    const latest = await readJson<XListMembersDigest>(latestPath);
    return latest.stats?.snapshotComplete === true;
  } catch {
    return false;
  }
}

export async function syncXListMembers(
  options: FetchXListMembersOptions & { acceptLargeShrink?: boolean },
): Promise<{
  digest: XListMembersDigest;
  jsonPath: string;
  latestPath: string;
  latestStatus: 'updated' | 'preserved' | 'unavailable';
}> {
  const digest = await fetchXListMembers(options);
  const paths = membersStorePaths(digest.listId);
  if (digest.stats.snapshotComplete && !options.acceptLargeShrink && await pathExists(paths.latest)) {
    try {
      const previous = await readJson<XListMembersDigest>(paths.latest);
      if (Array.isArray(previous.members)
        && previous.members.length > 0
        && digest.members.length < previous.members.length * 0.5) {
        digest.stats.snapshotComplete = false;
        digest.stats.stopReason = 'implausible shrink guard';
      }
    } catch {
      // A malformed previous pointer cannot block a fresh complete snapshot.
    }
  }
  const { jsonPath, latestPath, latestStatus } = await writeListMembersDigest(digest);
  return { digest, jsonPath, latestPath, latestStatus };
}
