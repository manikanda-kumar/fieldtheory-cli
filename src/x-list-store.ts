import path from 'node:path';
import { pathExists, readJson } from './fs.js';
import { xListsDir } from './paths.js';
import type { XListDigest } from './x-list-fetch.js';
import type { XListHtmlTweet } from './x-list-html.js';

export type StoredXListDigest = Omit<XListDigest, 'rawPages'>;

export interface CountRow {
  count: number;
}

export interface TodayAnalysis {
  listId: string;
  fetchedAt: string;
  totalTweets: number;
  listTweets: number;
  conversationContext: number;
  linkTypes: Array<{ type: string } & CountRow>;
  domains: Array<{ domain: string } & CountRow>;
  authors: Array<{ handle: string; name?: string; engagement: number } & CountRow>;
  topTweets: XListHtmlTweet[];
}

export interface TodaySourceRow {
  url: string;
  domain: string;
  type: string;
  count: number;
  authors: string[];
  tweetIds: string[];
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}

export async function readLatestXListDigest(listId: string): Promise<StoredXListDigest | null> {
  const file = path.join(xListsDir(), `${listId}-latest.json`);
  if (!(await pathExists(file))) return null;
  const digest = await readJson<StoredXListDigest>(file);
  return {
    listId: String(digest.listId),
    fetchedAt: String(digest.fetchedAt),
    tweets: Array.isArray(digest.tweets) ? digest.tweets : [],
    stats: digest.stats,
  };
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function compactRows<K extends string>(map: Map<string, number>, key: K): Array<Record<K, string> & CountRow> {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ [key]: name, count }) as Record<K, string> & CountRow);
}

export function linkType(url: string): string {
  const domain = linkDomain(url);
  if (domain === 'github.com' || domain.endsWith('.github.com')) return 'github';
  if (domain === 'arxiv.org') return 'arxiv';
  if (domain === 'youtube.com' || domain === 'youtu.be') return 'youtube';
  if (domain === 'huggingface.co') return 'huggingface';
  if (domain === 'news.ycombinator.com') return 'hn';
  if (domain.includes('substack.com') || domain === 'medium.com') return 'blog';
  return domain || 'link';
}

export function linkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function engagement(tweet: XListHtmlTweet): number {
  const e = tweet.engagement;
  return (e?.likeCount ?? 0) + (e?.repostCount ?? 0) * 3 + (e?.replyCount ?? 0) * 2 + (e?.quoteCount ?? 0) * 3 + Math.round((e?.viewCount ?? 0) / 1000);
}

export function deriveTodayAnalysis(digest: StoredXListDigest): TodayAnalysis {
  const linkTypes = new Map<string, number>();
  const domains = new Map<string, number>();
  const authorCounts = new Map<string, { count: number; name?: string; engagement: number }>();

  for (const tweet of digest.tweets) {
    const handle = tweet.author ?? 'unknown';
    const previous = authorCounts.get(handle) ?? { count: 0, name: tweet.authorName, engagement: 0 };
    authorCounts.set(handle, { count: previous.count + 1, name: previous.name ?? tweet.authorName, engagement: previous.engagement + engagement(tweet) });
    for (const link of tweet.links ?? []) {
      increment(linkTypes, linkType(link));
      const domain = linkDomain(link);
      if (domain) increment(domains, domain);
    }
  }

  const authors = Array.from(authorCounts.entries())
    .sort((a, b) => b[1].engagement - a[1].engagement || b[1].count - a[1].count)
    .map(([handle, row]) => ({ handle, name: row.name, count: row.count, engagement: row.engagement }));

  return {
    listId: digest.listId,
    fetchedAt: digest.fetchedAt,
    totalTweets: digest.tweets.length,
    listTweets: digest.tweets.filter((tweet) => tweet.timelineKind === 'list-tweet').length,
    conversationContext: digest.tweets.filter((tweet) => tweet.timelineKind === 'conversation-context').length,
    linkTypes: compactRows(linkTypes, 'type'),
    domains: compactRows(domains, 'domain'),
    authors,
    topTweets: [...digest.tweets].sort((a, b) => engagement(b) - engagement(a)).slice(0, 10),
  };
}

export function deriveTodaySources(digest: StoredXListDigest): TodaySourceRow[] {
  const byUrl = new Map<string, TodaySourceRow>();
  for (const tweet of digest.tweets) {
    for (const url of tweet.links ?? []) {
      const previous = byUrl.get(url) ?? {
        url,
        domain: linkDomain(url),
        type: linkType(url),
        count: 0,
        authors: [],
        tweetIds: [],
        firstSeenAt: tweet.postedAt,
        lastSeenAt: tweet.postedAt,
      };
      previous.count += 1;
      if (tweet.author && !previous.authors.includes(tweet.author)) previous.authors.push(tweet.author);
      if (tweet.id && !previous.tweetIds.includes(tweet.id)) previous.tweetIds.push(tweet.id);
      if (tweet.postedAt && (!previous.firstSeenAt || tweet.postedAt < previous.firstSeenAt)) previous.firstSeenAt = tweet.postedAt;
      if (tweet.postedAt && (!previous.lastSeenAt || tweet.postedAt > previous.lastSeenAt)) previous.lastSeenAt = tweet.postedAt;
      byUrl.set(url, previous);
    }
  }
  return Array.from(byUrl.values()).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

export function buildTodayContextPack(digest: StoredXListDigest): string {
  const analysis = deriveTodayAnalysis(digest);
  const sources = deriveTodaySources(digest).slice(0, 20);
  return [
    `# X List ${digest.listId} Today Context`,
    `Fetched: ${digest.fetchedAt}`,
    `Tweets: ${analysis.totalTweets} (${analysis.listTweets} list tweets, ${analysis.conversationContext} context)`,
    '',
    '## Top tweets',
    ...analysis.topTweets.slice(0, 10).map((tweet, index) => `${index + 1}. @${tweet.author ?? 'unknown'}: ${tweet.text ?? ''}\n   ${tweet.url ?? ''}`),
    '',
    '## Sources',
    ...sources.map((source, index) => `${index + 1}. [${source.type}] ${source.domain} — ${source.url} (${source.count} tweet${source.count === 1 ? '' : 's'})`),
  ].join('\n');
}