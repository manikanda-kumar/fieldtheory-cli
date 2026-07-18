import { searchCanonicalBookmarks, type CanonicalSearchResult } from './canonical-bookmarks-db.js';
import { isFollowingSnapshotComplete, searchFollowing, type FollowingSearchResult } from './following/db.js';
import { searchLibraryDocuments, type LibrarySearchResult } from './library.js';
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
  query: string;
  generatedAt: string;
  canonical: ResearchCanonicalHit[];
  library: LibrarySearchResult[];
  today: ResearchTodayHit[];
  experts: FollowingSearchResult[];
  next: string[];
}

export interface ResearchOptions {
  limit?: number;
  xListId?: string;
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

export async function researchLocalContext(query: string, options: ResearchOptions = {}): Promise<ResearchResult> {
  const limit = options.limit ?? 10;
  const trimmed = query.trim();

  const followingComplete = await isFollowingSnapshotComplete();
  const [canonical, library, experts] = await Promise.all([
    searchCanonicalBookmarks({ query: trimmed, limit }).then((rows) => rows.map(canonicalHit)).catch(() => []),
    Promise.resolve().then(() => searchLibraryDocuments(trimmed, { limit })).catch(() => []),
    followingComplete ? searchFollowing({ query: trimmed, limit }).catch(() => []) : Promise.resolve([]),
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

  return {
    query: trimmed,
    generatedAt: new Date().toISOString(),
    canonical,
    library,
    today,
    experts,
    next: [
      'ft show --unified <id> --json',
      'ft library show <path> --json',
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

  lines.push('', 'Experts');
  if (result.experts.length === 0) lines.push('  No expert hits.');
  for (const expert of result.experts) lines.push(`  - @${expert.handle} — ${expert.name}${expert.expertiseSummary ? `: ${expert.expertiseSummary}` : ''}`);

  lines.push('', 'Next');
  for (const command of result.next) lines.push(`  - ${command}`);

  return lines.join('\n');
}
