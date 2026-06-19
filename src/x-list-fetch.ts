import { loadChromeSessionConfig } from './config.js';
import { extractChromeXCookies } from './chrome-cookies.js';
import { extractFirefoxXCookies } from './firefox-cookies.js';
import { convertTweetToRecord } from './graphql-bookmarks.js';
import type { XListHtmlTweet } from './x-list-html.js';
import {
  classifyListTimelineEntry,
  dropQuotedOriginals,
  isWithinSinceHours,
  mergeTimelineKind,
  shouldStopAfterPage,
  type ListTimelineKind,
} from './x-list-timeline.js';

// Public web bearer used by the logged-in x.com GraphQL endpoints.
const X_PUBLIC_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export const LIST_LATEST_TWEETS_QUERY_ID = 'K77PSxWq_St4HLusAV9nVg';
const LIST_LATEST_TWEETS_OPERATION = 'ListLatestTweetsTimeline';

const LIST_TIMELINE_FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  rweb_cashtags_composer_attachment_enabled: false,
  responsive_web_jetfuel_frame: false,
  responsive_web_grok_share_attachment_enabled: false,
  responsive_web_grok_annotations_enabled: false,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  rweb_conversational_replies_downvote_enabled: false,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: false,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: false,
  responsive_web_grok_imagine_annotation_enabled: false,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};

const LIST_TIMELINE_FIELD_TOGGLES = {
  withPayments: false,
  withAuxiliaryUserLabels: false,
  withArticleRichContentState: true,
  withArticlePlainText: false,
  withArticleSummaryText: false,
  withArticleVoiceOver: false,
  withGrokAnalyze: false,
  withDisallowedReplyControls: false,
};

export interface FetchXListOptions {
  /** List id, or an x.com/i/lists/<id> URL — resolved automatically. */
  listId: string;
  count?: number;
  cursor?: string;
  sinceHours?: number;
  maxPages?: number;
  delayMs?: number;
  queryId?: string;
  browser?: string;
  chromeUserDataDir?: string;
  chromeProfileDirectory?: string;
  firefoxProfileDir?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface XListDigest {
  listId: string;
  fetchedAt: string;
  tweets: XListHtmlTweet[];
  rawPages: unknown[];
  stats: {
    count: number;
    fetchedCount: number;
    timeFilteredCount: number;
    quotedOriginalsDropped: number;
    pagesFetched: number;
    stopReason: string;
    nextCursor?: string;
    sinceHours?: number;
  };
}

type TweetRecord = NonNullable<ReturnType<typeof convertTweetToRecord>>;
type RecordEntry = { record: TweetRecord; timelineKind: ListTimelineKind };

/** Pull the numeric list id out of a raw id or an x.com/i/lists/<id> URL. */
export function parseListId(input: string): string {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/\/lists\/(\d+)/)?.[1];
  if (fromUrl) return fromUrl;
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid X list id or URL: ${input}`);
  }
  return trimmed;
}

function getBrowserSession(options: FetchXListOptions): { csrfToken: string; cookieHeader: string } {
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
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    cookie: cookieHeader,
  };
}

function buildListTimelineUrl(listId: string, queryId: string, count: number, cursor?: string): string {
  const variables: Record<string, unknown> = { listId, count };
  if (cursor) variables.cursor = cursor;
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(LIST_TIMELINE_FEATURES),
    fieldToggles: JSON.stringify(LIST_TIMELINE_FIELD_TOGGLES),
  });
  return `https://x.com/i/api/graphql/${queryId}/${LIST_LATEST_TWEETS_OPERATION}?${params}`;
}

function collectEntries(json: unknown): unknown[] {
  const root = json as { data?: { list?: { tweets_timeline?: { timeline?: { instructions?: unknown[] } } } } };
  const instructions = root.data?.list?.tweets_timeline?.timeline?.instructions;
  if (!Array.isArray(instructions)) return [];

  const entries: unknown[] = [];
  for (const instruction of instructions) {
    const inst = instruction as { type?: unknown; entries?: unknown[]; entry?: unknown };
    if (inst.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) entries.push(...inst.entries);
    if (inst.type === 'TimelineAddEntry' && inst.entry) entries.push(inst.entry);
  }
  return entries;
}

function parseTimeline(json: unknown, now: string): { records: RecordEntry[]; nextCursor?: string } {
  const recordsById = new Map<string, RecordEntry>();
  let nextCursor: string | undefined;

  for (const entry of collectEntries(json)) {
    const item = entry as {
      entryId?: string;
      sortIndex?: string;
      content?: {
        value?: string;
        itemContent?: { tweet_results?: { result?: unknown } };
        items?: Array<{ item?: { itemContent?: { tweet_results?: { result?: unknown } } } }>;
      };
    };

    if (item.entryId?.startsWith('cursor-bottom')) {
      nextCursor = item.content?.value;
      continue;
    }

    const timelineKind = classifyListTimelineEntry(item.entryId);
    const tweetResults = [
      item.content?.itemContent?.tweet_results?.result,
      ...(item.content?.items ?? []).map((nested) => nested.item?.itemContent?.tweet_results?.result),
    ].filter(Boolean);

    for (const tweetResult of tweetResults) {
      const record = convertTweetToRecord(tweetResult, now);
      if (record) {
        record.sortIndex = item.sortIndex ?? null;
        const id = record.tweetId ?? record.id;
        const existing = recordsById.get(id);
        recordsById.set(id, {
          record: existing?.record ?? record,
          timelineKind: mergeTimelineKind(existing?.timelineKind, timelineKind),
        });
      }
    }
  }

  return { records: Array.from(recordsById.values()), nextCursor };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Fetch a public X list timeline, time-filter it, and return tweet records ready for HTML. */
export async function fetchXListDigest(options: FetchXListOptions): Promise<XListDigest> {
  const listId = parseListId(options.listId);
  const count = options.count ?? 40;
  const queryId = options.queryId ?? LIST_LATEST_TWEETS_QUERY_ID;
  const delayMs = options.delayMs ?? 750;
  const maxPages = options.maxPages ?? (options.sinceHours !== undefined ? 5 : 1);
  const fetchImpl = options.fetchImpl ?? fetch;
  const nowMs = options.now ?? Date.now;

  const session = getBrowserSession(options);
  const headers = buildHeaders(session.csrfToken, session.cookieHeader);

  const rawPages: unknown[] = [];
  const allRecordsById = new Map<string, RecordEntry>();
  let cursor = options.cursor;
  let pagesFetched = 0;
  let stopReason = 'max-pages';

  for (let page = 0; page < maxPages; page += 1) {
    const url = buildListTimelineUrl(listId, queryId, count, cursor);
    const response = await fetchImpl(url, { headers });
    const text = await response.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`X returned non-JSON HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    if (!response.ok) {
      throw new Error(`X GraphQL returned HTTP ${response.status}: ${text.slice(0, 1000)}`);
    }

    const parsed = parseTimeline(json, new Date(nowMs()).toISOString());
    rawPages.push(json);
    pagesFetched += 1;

    for (const item of parsed.records) {
      const id = item.record.tweetId ?? item.record.id;
      const existing = allRecordsById.get(id);
      allRecordsById.set(id, {
        record: existing?.record ?? item.record,
        timelineKind: mergeTimelineKind(existing?.timelineKind, item.timelineKind),
      });
    }

    if (!parsed.nextCursor) {
      stopReason = 'no-cursor';
      break;
    }
    if (
      shouldStopAfterPage(
        parsed.records.map((item) => ({ timelineKind: item.timelineKind, postedAt: item.record.postedAt })),
        options.sinceHours,
        nowMs()
      )
    ) {
      stopReason = 'older-than-since-window';
      break;
    }
    cursor = parsed.nextCursor;
    if (page < maxPages - 1 && delayMs > 0) await sleep(delayMs);
  }

  const allRecords = Array.from(allRecordsById.values());
  const timeFilteredRecords = allRecords.filter(({ record }) =>
    isWithinSinceHours(record.postedAt, options.sinceHours, nowMs())
  );
  const filteredRecords = dropQuotedOriginals(
    timeFilteredRecords.map((item) => ({
      ...item,
      id: item.record.tweetId ?? item.record.id,
      quotedTweetId: item.record.quotedTweet?.id ?? item.record.quotedStatusId,
    }))
  );

  const tweets: XListHtmlTweet[] = filteredRecords.map(({ record, timelineKind }) => ({
    id: record.tweetId,
    timelineKind,
    url: record.url,
    author: record.authorHandle,
    authorName: record.authorName,
    postedAt: record.postedAt,
    text: record.text,
    links: record.links,
    engagement: record.engagement,
    mediaObjects: record.mediaObjects,
    quotedTweet: record.quotedTweet,
  }));

  return {
    listId,
    fetchedAt: new Date(nowMs()).toISOString(),
    tweets,
    rawPages,
    stats: {
      count: filteredRecords.length,
      fetchedCount: allRecords.length,
      timeFilteredCount: timeFilteredRecords.length,
      quotedOriginalsDropped: timeFilteredRecords.length - filteredRecords.length,
      pagesFetched,
      stopReason,
      nextCursor: cursor,
      sinceHours: options.sinceHours,
    },
  };
}
