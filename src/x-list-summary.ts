/**
 * X list daily summary: turn the stored list digest (`<listId>-latest.json`)
 * into a short markdown briefing via the LLM engine chain, with a mechanical
 * fallback so unattended daily runs always produce something readable.
 */

import fs from 'node:fs';
import path from 'node:path';

import { invokeEngineAsync, resolveEngine, withSystemOverride, describeEngine, type EngineRunProfile } from './engine.js';
import { deriveTodayAnalysis, deriveTodaySources, readLatestXListDigest, type StoredXListDigest } from './x-list-store.js';
import { libraryDir, xListsDir } from './paths.js';
import type { XListHtmlTweet } from './x-list-html.js';

const DEFAULT_PROMPT_TWEETS = 80;
const TWEET_TEXT_CHARS = 400;
const SUMMARY_INVOKE_TIMEOUT_MS = 300_000;

export interface XListSummaryOptions {
  profile?: EngineRunProfile;
  /** Test seam: replaces engine resolution + invocation. */
  invoke?: (prompt: string) => Promise<string>;
  /** Top tweets (by engagement) included in the prompt. Default: 80. */
  maxTweets?: number;
  /** Explicit markdown output path; defaults to the library daily x-list dir. */
  outputPath?: string;
  /** Overwrite an existing summary for the same date. */
  force?: boolean;
  /** Stable clock injection for tests. */
  now?: Date;
}

export interface XListSummaryResult {
  summaryPath: string;
  /** Stable pointer beside the digest JSON, overwritten each run. */
  latestPath: string;
  date: string;
  listId: string;
  tweetCount: number;
  promptTweets: number;
  usedLlm: boolean;
  engineLabel?: string;
  llmError?: string;
  skipped?: boolean;
}

function engagementScore(tweet: XListHtmlTweet): number {
  const e = tweet.engagement;
  return (e?.likeCount ?? 0) + (e?.repostCount ?? 0) * 3 + (e?.replyCount ?? 0) * 2 + (e?.quoteCount ?? 0) * 3 + Math.round((e?.viewCount ?? 0) / 1000);
}

function truncate(text: string, max: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

/** Markdown output directory: ~/.fieldtheory/library/daily/x-list/. */
export function xListSummaryDir(): string {
  return path.join(libraryDir(), 'daily', 'x-list');
}

export function xListSummaryPath(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid summary date: ${date}`);
  return path.join(xListSummaryDir(), `${date}.md`);
}

export function buildXListSummaryPrompt(digest: StoredXListDigest, maxTweets: number = DEFAULT_PROMPT_TWEETS): string {
  const analysis = deriveTodayAnalysis(digest);
  const sources = deriveTodaySources(digest).slice(0, 20);
  const top = [...digest.tweets]
    .filter((tweet) => tweet.timelineKind === 'list-tweet')
    .sort((a, b) => engagementScore(b) - engagementScore(a))
    .slice(0, maxTweets);

  const tweetLines = top.map((tweet, index) => {
    const e = tweet.engagement;
    const stats = `${e?.likeCount ?? 0} likes, ${e?.repostCount ?? 0} reposts, ${e?.replyCount ?? 0} replies`;
    return `${index + 1}. @${tweet.author ?? 'unknown'} (${stats}): ${truncate(tweet.text ?? '', TWEET_TEXT_CHARS)}\n   URL: ${tweet.url ?? ''}`;
  });

  const task = [
    `Below are the highest-engagement posts from an X (Twitter) list over the last 24 hours (${analysis.totalTweets} posts total; top ${top.length} shown), plus the most-shared external links.`,
    '',
    'Write a concise daily briefing in markdown with exactly these sections:',
    '',
    '## Top themes',
    '5-7 themes, most important first. Each theme: a bold one-line name, then 2-4 sentences synthesizing what several posts are saying (agreements, disagreements, what is new today). After each theme, list the supporting post URLs on their own lines as markdown links titled with the author handle.',
    '',
    '## Notable releases & links',
    'Up to 10 bullet points for concrete artifacts (repos, papers, models, blog posts, tools) that the list shared, each with the external link and a half-sentence on why it matters.',
    '',
    '## Worth a closer look',
    '3-5 individual posts that are high-signal but did not fit a theme (contrarian takes, deep threads, surprising results), each with the post URL and one sentence.',
    '',
    'Rules: only reference posts and links that appear in the data below — never invent URLs. Plain markdown only, no preamble, no code fences, start directly with "## Top themes".',
    '',
    '--- DATA ---',
    '',
    '# Top posts by engagement',
    ...tweetLines,
    '',
    '# Most-shared external links',
    ...sources.map((source, index) => `${index + 1}. [${source.type}] ${source.url} (shared in ${source.count} post${source.count === 1 ? '' : 's'} by ${source.authors.slice(0, 5).join(', ')})`),
  ].join('\n');

  return withSystemOverride('research analyst producing a daily intelligence briefing from social media data', task);
}

/** Deterministic fallback when every engine invocation fails. */
export function buildMechanicalSummary(digest: StoredXListDigest): string {
  const analysis = deriveTodayAnalysis(digest);
  const sources = deriveTodaySources(digest).slice(0, 15);
  return [
    '## Top posts',
    ...analysis.topTweets.map((tweet, index) => `${index + 1}. [@${tweet.author ?? 'unknown'}](${tweet.url ?? ''}) — ${truncate(tweet.text ?? '', 220)}`),
    '',
    '## Most-shared links',
    ...sources.map((source, index) => `${index + 1}. [${source.type}] ${source.url} (${source.count} post${source.count === 1 ? '' : 's'})`),
    '',
    '## Top authors by engagement',
    ...analysis.authors.slice(0, 10).map((author, index) => `${index + 1}. @${author.handle}${author.name ? ` (${author.name})` : ''} — ${author.count} posts`),
  ].join('\n');
}

function summaryTimeoutMs(): number {
  const raw = Number(process.env.FT_DAILY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : SUMMARY_INVOKE_TIMEOUT_MS;
}

/** Strip accidental code fences around the whole response. */
function cleanEngineMarkdown(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  if (fenced) text = fenced[1].trim();
  return text;
}

export async function summarizeXList(listId: string, options: XListSummaryOptions = {}): Promise<XListSummaryResult> {
  const digest = await readLatestXListDigest(listId);
  if (!digest || digest.tweets.length === 0) {
    throw new Error(`No stored digest for list ${listId} — run \`ft x-list ${listId} --since-hours 24\` first.`);
  }

  const now = options.now ?? new Date();
  const date = now.toISOString().slice(0, 10);
  const summaryPath = options.outputPath ?? xListSummaryPath(date);
  const latestPath = path.join(xListsDir(), `${digest.listId}-summary-latest.md`);

  if (!options.outputPath && !options.force && fs.existsSync(summaryPath)) {
    return {
      summaryPath,
      latestPath,
      date,
      listId: digest.listId,
      tweetCount: digest.tweets.length,
      promptTweets: 0,
      usedLlm: false,
      skipped: true,
    };
  }

  const maxTweets = options.maxTweets ?? DEFAULT_PROMPT_TWEETS;
  const prompt = buildXListSummaryPrompt(digest, maxTweets);
  const promptTweets = Math.min(maxTweets, digest.tweets.filter((tweet) => tweet.timelineKind === 'list-tweet').length);

  let body: string;
  let usedLlm = false;
  let engineLabel: string | undefined;
  let llmError: string | undefined;
  try {
    if (options.invoke) {
      body = cleanEngineMarkdown(await options.invoke(prompt));
      usedLlm = true;
    } else {
      const engine = await resolveEngine(options.profile ?? {});
      engineLabel = describeEngine(engine);
      body = cleanEngineMarkdown(await invokeEngineAsync(engine, prompt, {
        timeout: summaryTimeoutMs(),
        maxBuffer: 1024 * 1024 * 4,
      }));
      usedLlm = true;
    }
    if (!body || !body.includes('##')) throw new Error('engine returned no markdown sections');
  } catch (error) {
    llmError = error instanceof Error ? error.message : String(error);
    body = buildMechanicalSummary(digest);
    usedLlm = false;
  }

  const analysis = deriveTodayAnalysis(digest);
  const markdown = [
    '---',
    `date: "${date}"`,
    `list_id: "${digest.listId}"`,
    `fetched_at: "${digest.fetchedAt}"`,
    `tweets: ${digest.tweets.length}`,
    `list_tweets: ${analysis.listTweets}`,
    `prompt_tweets: ${promptTweets}`,
    `synthesis: ${usedLlm ? 'llm' : 'mechanical'}`,
    ...(engineLabel ? [`synthesis_engine: "${engineLabel}"`] : []),
    '---',
    '',
    `# X List Daily Summary — ${date}`,
    '',
    `> List ${digest.listId} · ${analysis.listTweets} posts in the last 24h · fetched ${digest.fetchedAt}`,
    '',
    body,
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(summaryPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(summaryPath, markdown, { mode: 0o600 });
  fs.writeFileSync(latestPath, markdown, { mode: 0o600 });

  return {
    summaryPath,
    latestPath,
    date,
    listId: digest.listId,
    tweetCount: digest.tweets.length,
    promptTweets,
    usedLlm,
    engineLabel,
    llmError,
  };
}
