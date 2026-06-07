import { writeFileSync } from 'node:fs';
import { loadChromeSessionConfig } from '../src/config.js';
import { extractChromeXCookies } from '../src/chrome-cookies.js';
import { extractFirefoxXCookies } from '../src/firefox-cookies.js';
import { convertTweetToRecord } from '../src/graphql-bookmarks.js';
import { renderXListHtml, type XListHtmlTweet } from '../src/x-list-html.js';
import { classifyListTimelineEntry, dropQuotedOriginals, isWithinSinceHours, mergeTimelineKind, shouldStopAfterPage, type ListTimelineKind } from '../src/x-list-timeline.js';

const X_PUBLIC_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const LIST_LATEST_TWEETS_QUERY_ID = 'K77PSxWq_St4HLusAV9nVg';
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

interface Options {
  listId: string;
  count: number;
  cursor?: string;
  browser?: string;
  chromeUserDataDir?: string;
  chromeProfileDirectory?: string;
  firefoxProfileDir?: string;
  output?: string;
  rawOutput?: string;
  htmlOutput?: string;
  sinceHours?: number;
  maxPages: number;
  delayMs: number;
  queryId: string;
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv: string[]): Options {
  const listId = argv[0]?.match(/\/lists\/(\d+)/)?.[1] ?? argv[0];
  if (!listId || listId.startsWith('--')) {
    throw new Error('Usage: tsx scripts/prototype-fetch-x-list.ts <list-id-or-url> [--count 40] [--output out.json]');
  }

  const options: Options = {
    listId,
    count: 40,
    maxPages: argv.includes('--since-hours') ? 5 : 1,
    delayMs: 750,
    queryId: LIST_LATEST_TWEETS_QUERY_ID,
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--count':
        options.count = Number(takeValue(argv, i, arg));
        i += 1;
        break;
      case '--cursor':
        options.cursor = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--browser':
        options.browser = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--chrome-user-data-dir':
        options.chromeUserDataDir = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--chrome-profile-directory':
        options.chromeProfileDirectory = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--firefox-profile-dir':
        options.firefoxProfileDir = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--output':
        options.output = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--raw-output':
        options.rawOutput = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--html-output':
        options.htmlOutput = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--since-hours':
        options.sinceHours = Number(takeValue(argv, i, arg));
        i += 1;
        break;
      case '--max-pages':
        options.maxPages = Number(takeValue(argv, i, arg));
        i += 1;
        break;
      case '--delay-ms':
        options.delayMs = Number(takeValue(argv, i, arg));
        i += 1;
        break;
      case '--query-id':
        options.queryId = takeValue(argv, i, arg);
        i += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.count) || options.count < 1 || options.count > 100) {
    throw new Error('--count must be a number from 1 to 100');
  }

  if (options.sinceHours !== undefined && (!Number.isFinite(options.sinceHours) || options.sinceHours <= 0)) {
    throw new Error('--since-hours must be a positive number');
  }

  if (!Number.isFinite(options.maxPages) || options.maxPages < 1) {
    throw new Error('--max-pages must be a positive number');
  }

  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay-ms must be zero or a positive number');
  }

  return options;
}

function getBrowserSession(options: Options): { csrfToken: string; cookieHeader: string } {
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
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    cookie: cookieHeader,
  };
}

function buildListTimelineUrl(options: Options): string {
  const variables: Record<string, unknown> = {
    listId: options.listId,
    count: options.count,
  };
  if (options.cursor) variables.cursor = options.cursor;

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(LIST_TIMELINE_FEATURES),
    fieldToggles: JSON.stringify(LIST_TIMELINE_FIELD_TOGGLES),
  });

  return `https://x.com/i/api/graphql/${options.queryId}/${LIST_LATEST_TWEETS_OPERATION}?${params}`;
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

function parseTimeline(json: unknown) {
  const now = new Date().toISOString();
  const recordsById = new Map<string, { record: NonNullable<ReturnType<typeof convertTweetToRecord>>; timelineKind: ListTimelineKind }>();
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

  const records = Array.from(recordsById.values());
  return { records, nextCursor };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTimelinePage(
  options: Options,
  session: { csrfToken: string; cookieHeader: string },
  cursor: string | undefined
): Promise<{ json: unknown; parsed: ReturnType<typeof parseTimeline> }> {
  const response = await fetch(buildListTimelineUrl({ ...options, cursor }), {
    headers: buildHeaders(session.csrfToken, session.cookieHeader),
  });
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

  return { json, parsed: parseTimeline(json) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const session = getBrowserSession(options);

  const rawPages: unknown[] = [];
  const allRecordsById = new Map<string, { record: NonNullable<ReturnType<typeof convertTweetToRecord>>; timelineKind: ListTimelineKind }>();
  let cursor = options.cursor;
  let pagesFetched = 0;
  let stopReason = 'max-pages';

  for (let page = 0; page < options.maxPages; page += 1) {
    const { json, parsed } = await fetchTimelinePage(options, session, cursor);
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

    if (shouldStopAfterPage(parsed.records.map((item) => ({
      timelineKind: item.timelineKind,
      postedAt: item.record.postedAt,
    })), options.sinceHours)) {
      stopReason = 'older-than-since-window';
      break;
    }

    cursor = parsed.nextCursor;
    if (page < options.maxPages - 1 && options.delayMs > 0) await sleep(options.delayMs);
  }

  if (options.rawOutput) {
    writeFileSync(options.rawOutput, `${JSON.stringify(rawPages, null, 2)}\n`, { mode: 0o600 });
  }

  const allRecords = Array.from(allRecordsById.values());
  const timeFilteredRecords = allRecords.filter(({ record }) =>
    isWithinSinceHours(record.postedAt, options.sinceHours)
  );
  const filteredRecords = dropQuotedOriginals(timeFilteredRecords.map((item) => ({
    ...item,
    id: item.record.tweetId ?? item.record.id,
    quotedTweetId: item.record.quotedTweet?.id ?? item.record.quotedStatusId,
  })));
  const fetchedAt = new Date().toISOString();
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
  const output = {
    listId: options.listId,
    fetchedAt,
    count: filteredRecords.length,
    fetchedCount: allRecords.length,
    timeFilteredCount: timeFilteredRecords.length,
    quotedOriginalsDropped: timeFilteredRecords.length - filteredRecords.length,
    pagesFetched,
    stopReason,
    sinceHours: options.sinceHours,
    nextCursor: cursor,
    tweets: filteredRecords.map(({ record, timelineKind }) => ({
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
      conversationId: record.conversationId,
      inReplyToStatusId: record.inReplyToStatusId,
      quotedStatusId: record.quotedStatusId,
      quotedTweet: record.quotedTweet,
    })),
  };

  if (options.htmlOutput) {
    writeFileSync(options.htmlOutput, renderXListHtml({ listId: options.listId, fetchedAt, tweets }), { mode: 0o600 });
  }

  const rendered = `${JSON.stringify(output, null, 2)}\n`;
  if (options.output) {
    writeFileSync(options.output, rendered, { mode: 0o600 });
    console.log(`Wrote ${filteredRecords.length} tweets to ${options.output}`);
  } else {
    console.log(rendered);
  }

  if (options.htmlOutput) console.log(`Wrote HTML to ${options.htmlOutput}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
