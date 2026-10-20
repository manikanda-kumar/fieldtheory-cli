import path from 'node:path';
import { searchCanonicalBookmarks, type CanonicalSearchResult } from './canonical-bookmarks-db.js';
import { isFollowingSnapshotComplete, searchFollowing, type FollowingSearchResult } from './following/db.js';
import { searchLibraryDocuments, type LibrarySearchResult } from './library.js';
import { getLibraryIndexStats, searchLibraryDocs } from './library-index-db.js';
import { canonicalCommandsDir, canonicalLibraryDir } from './paths.js';
import { searchTweetsmashBookmarks, tweetIdFromStatusUrl, type TweetsmashSearchHit } from './tweetsmash-search.js';
import { deriveTodaySources, readLatestXListDigest, type TodaySourceRow } from './x-list-store.js';

export interface ResearchCanonicalHit {
  id: string;
  title: string;
  url: string | null;
  snippet: string;
  sources: string[];
  score: number;
}

export interface ResearchTodayHit {
  kind: 'x-list-source';
  url: string;
  domain: string;
  type: string;
  count: number;
  authors: string[];
}

export interface ResearchResult {
  schemaVersion: 1;
  query: string;
  generatedAt: string;
  canonical: ResearchCanonicalHit[];
  library: LibrarySearchResult[];
  today: ResearchTodayHit[];
  experts: FollowingSearchResult[];
  tweetsmash: ResearchCanonicalHit[];
  /** Per-group: true when the group filled its limit and more hits may exist. */
  truncated: { canonical: boolean; library: boolean; today: boolean; experts: boolean; tweetsmash: boolean };
  next: string[];
}

export interface ResearchOptions {
  limit?: number;
  xListId?: string;
  tweetsmash?: boolean;
  fetchImpl?: typeof fetch;
}

function compactSnippet(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 280 ? `${compact.slice(0, 277)}...` : compact;
}

function canonicalHit(row: CanonicalSearchResult): ResearchCanonicalHit {
  return {
    id: row.id,
    title: row.displayTitle?.trim() || row.canonicalUrl || row.id,
    url: row.canonicalUrl,
    snippet: compactSnippet(row.searchText),
    sources: row.sources,
    score: row.score,
  };
}

function todayHit(row: TodaySourceRow): ResearchTodayHit {
  return {
    kind: 'x-list-source',
    url: row.url,
    domain: row.domain,
    type: row.type,
    count: row.count,
    authors: row.authors,
  };
}

function todayMatches(row: TodaySourceRow, query: string): boolean {
  const haystack = [row.url, row.domain, row.type, row.authors.join(' ')].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).some((part) => haystack.includes(part));
}

function tweetsmashResearchHit(hit: TweetsmashSearchHit): ResearchCanonicalHit {
  return {
    id: hit.postId,
    title: hit.authorHandle ? `@${hit.authorHandle}` : hit.postId,
    url: hit.url,
    snippet: compactSnippet(hit.text),
    sources: ['tweetsmash'],
    score: 0,
  };
}

async function researchLibrary(query: string, limit: number): Promise<LibrarySearchResult[]> {
  try {
    // The search API returns [] both for a missing index and for zero matches.
    // Check its indexed state first so a real miss never starts a tree walk.
    if ((await getLibraryIndexStats()).indexed) {
      const docs = await searchLibraryDocs({ query, place: 'library', limit });
      return docs.map(({ path, relPath, title, updatedAt, size, snippet }) => ({
        path, relPath, title, updatedAt, size, snippet,
      }));
    }
  } catch {
    // Missing or unreadable index: use the portable Markdown search below.
  }
  return searchLibraryDocuments(query, {
    limit,
    excludeDirs: [path.join(canonicalLibraryDir(), 'bookmarks'), canonicalCommandsDir()],
  });
}

export async function researchLocalContext(query: string, options: ResearchOptions = {}): Promise<ResearchResult> {
  const limit = options.limit ?? 10;
  const trimmed = query.trim();
  const useTweetsmash = options.tweetsmash !== false;

  const followingComplete = await isFollowingSnapshotComplete();
  const [canonical, library, experts, smash] = await Promise.all([
    searchCanonicalBookmarks({ query: trimmed, limit }).then((rows) => rows.map(canonicalHit)).catch(() => []),
    researchLibrary(trimmed, limit).catch(() => []),
    followingComplete ? searchFollowing({ query: trimmed, limit }).catch(() => []) : Promise.resolve([]),
    useTweetsmash
      ? searchTweetsmashBookmarks({ query: trimmed, limit, fetchImpl: options.fetchImpl }).catch(() => ({ hits: [], skipped: true, reason: 'network' }))
      : Promise.resolve({ hits: [] as TweetsmashSearchHit[], skipped: true, reason: 'disabled' }),
  ]);

  let today: ResearchTodayHit[] = [];
  if (options.xListId) {
    const digest = await readLatestXListDigest(options.xListId).catch(() => null);
    if (digest) {
      today = deriveTodaySources(digest)
        .filter((row) => todayMatches(row, trimmed))
        .slice(0, limit)
        .map(todayHit);
    }
  }

  const localIds = new Set(canonical.flatMap((hit) => {
    const tweetId = tweetIdFromStatusUrl(hit.url);
    return tweetId ? [hit.id, tweetId] : [hit.id];
  }));
  const tweetsmash = smash.hits
    .filter((hit) => !localIds.has(hit.postId))
    .slice(0, limit)
    .map(tweetsmashResearchHit);

  return {
    schemaVersion: 1,
    query: trimmed,
    generatedAt: new Date().toISOString(),
    canonical,
    library,
    today,
    experts,
    tweetsmash,
    truncated: {
      canonical: canonical.length >= limit,
      library: library.length >= limit,
      today: today.length >= limit,
      experts: experts.length >= limit,
      tweetsmash: tweetsmash.length >= limit,
    },
    next: [
      'ft show --unified <id> --json',
      'ft library show <path> [--from-line <n> --max-lines <n>] --json',
      'ft experts show @handle --json',
      'ft ask "<question>" --json',
    ],
  };
}

export function formatResearchResult(result: ResearchResult): string {
  const lines: string[] = [`Research: ${result.query}`, ''];

  lines.push('Canonical Library');
  if (result.canonical.length === 0) lines.push('  No canonical hits.');
  for (const hit of result.canonical) {
    lines.push(`  - ${hit.title} ${hit.sources.map((source) => `[${source}]`).join(' ')}`);
    if (hit.url) lines.push(`    ${hit.url}`);
    if (hit.snippet) lines.push(`    ${hit.snippet}`);
  }

  lines.push('', 'Library Markdown');
  if (result.library.length === 0) lines.push('  No markdown hits.');
  for (const hit of result.library) {
    lines.push(`  - ${hit.title} (${hit.relPath})`);
    if (hit.snippet) lines.push(`    ${hit.snippet}`);
  }

  lines.push('', 'Today');
  if (result.today.length === 0) lines.push('  No matching latest-list sources.');
  for (const hit of result.today) lines.push(`  - [${hit.type}] ${hit.domain} — ${hit.url} (${hit.count})`);

  lines.push('', 'Tweetsmash');
  if (result.tweetsmash.length === 0) lines.push('  No additional Tweetsmash hits.');
  for (const hit of result.tweetsmash) {
    lines.push(`  - ${hit.title}`);
    if (hit.url) lines.push(`    ${hit.url}`);
    if (hit.snippet) lines.push(`    ${hit.snippet}`);
  }

  lines.push('', 'Experts');
  if (result.experts.length === 0) lines.push('  No expert hits.');
  for (const expert of result.experts) lines.push(`  - @${expert.handle} — ${expert.name}${expert.expertiseSummary ? `: ${expert.expertiseSummary}` : ''}`);

  lines.push('', 'Next');
  for (const command of result.next) lines.push(`  - ${command}`);

  return lines.join('\n');
}
