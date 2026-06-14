/**
 * Bookmark-to-markdown export.
 *
 * ft md [--force|--changed]
 *
 * Exports each bookmark as an individual .md file with YAML frontmatter,
 * full tweet text, and [[wikilinks]] to wiki category/domain/entity pages.
 * No LLM required — fast, deterministic, portable.
 *
 * Output: ~/.fieldtheory/library/bookmarks/<date>-<author>-<slug>.md
 */

import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, writeMd, readJsonLines } from './fs.js';
import { mdDir } from './paths.js';
import { listBookmarks, countBookmarks, type BookmarkTimelineItem } from './bookmarks-db.js';
import { parseTimestampMs, toIsoDate } from './date-utils.js';
import { slug } from './md.js';
import {
  listCanonicalBookmarks,
  getCanonicalBookmarkSources,
  type CanonicalBookmarkListResult,
  type CanonicalSourceRow,
} from './canonical-bookmarks-db.js';
import { raindropBookmarksCachePath } from './raindrop/paths.js';
import type { RaindropRecord } from './raindrop/types.js';
import { githubStarsCachePath } from './github-stars/paths.js';
import type { GitHubStarRecord } from './github-stars/types.js';

export interface ExportOptions {
  force?: boolean;
  changed?: boolean;
  onProgress?: (status: string) => void;
}

export interface ExportResult {
  exported: number;
  skipped: number;
  total: number;
  elapsed: number;
}

function bookmarksDir(): string {
  return path.join(mdDir(), 'bookmarks');
}

function exportDate(value?: string | null): string | null {
  return toIsoDate(value);
}

function bookmarkFilename(b: BookmarkTimelineItem): string {
  const date = exportDate(b.postedAt ?? b.bookmarkedAt) ?? 'undated';
  const author = b.authorHandle ? slug(b.authorHandle) : 'unknown';
  const textSlug = slug(b.text.slice(0, 50)) || b.id;
  return `${date}-${author}-${textSlug}.md`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function latestSourceUpdateMs(b: BookmarkTimelineItem): number | null {
  const values = [b.syncedAt, b.enrichedAt]
    .map((value) => value ? parseTimestampMs(value) : null)
    .filter((value): value is number => value != null);
  return values.length > 0 ? Math.max(...values) : null;
}

function shouldExportBookmark(b: BookmarkTimelineItem, filePath: string, options: ExportOptions): boolean {
  if (options.force) return true;
  if (!fs.existsSync(filePath)) return true;
  if (!options.changed) return false;

  const changedAt = latestSourceUpdateMs(b);
  if (changedAt == null) return false;

  const fileMtime = fs.statSync(filePath).mtimeMs;
  return changedAt > fileMtime;
}

function buildBookmarkMd(b: BookmarkTimelineItem): string {
  const lines: string[] = [];

  // ── Frontmatter ─────────────────────────────────────────────────────
  lines.push('---');
  if (b.authorHandle) lines.push(`author: "@${b.authorHandle}"`);
  if (b.authorName) lines.push(`author_name: "${b.authorName.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
  const postedAt = exportDate(b.postedAt);
  const bookmarkedAt = exportDate(b.bookmarkedAt);
  if (postedAt) lines.push(`posted_at: ${postedAt}`);
  if (bookmarkedAt) lines.push(`bookmarked_at: ${bookmarkedAt}`);
  if (b.primaryCategory) lines.push(`category: ${b.primaryCategory}`);
  if (b.primaryDomain) lines.push(`domain: ${b.primaryDomain}`);
  if (b.categories.length > 0) lines.push(`categories: [${b.categories.join(', ')}]`);
  if (b.domains.length > 0) lines.push(`domains: [${b.domains.join(', ')}]`);
  lines.push(`source_url: ${b.url}`);
  lines.push(`tweet_id: "${b.tweetId}"`);
  if (b.likeCount) lines.push(`likes: ${b.likeCount}`);
  if (b.repostCount) lines.push(`reposts: ${b.repostCount}`);
  if (b.viewCount) lines.push(`views: ${b.viewCount}`);
  lines.push('---');
  lines.push('');

  // ── Title ───────────────────────────────────────────────────────────
  const author = b.authorHandle ? `@${b.authorHandle}` : 'Unknown';
  lines.push(`# ${author}`);
  lines.push('');

  // ── Body ────────────────────────────────────────────────────────────
  lines.push(b.text);
  lines.push('');

  // ── Enriched article content ───────────────────────────────────────
  if (b.articleText) {
    lines.push('## Article');
    if (b.articleTitle) {
      lines.push(`### ${oneLine(b.articleTitle)}`);
      lines.push('');
    }
    if (b.articleSite) {
      lines.push(`Source: ${oneLine(b.articleSite)}`);
      lines.push('');
    }
    lines.push(b.articleText.trim());
    lines.push('');
  }

  // ── Links ───────────────────────────────────────────────────────────
  if (b.links.length > 0) {
    lines.push('## Links');
    for (const link of b.links) lines.push(`- ${link}`);
    lines.push('');
  }

  if (b.githubUrls.length > 0) {
    lines.push('## GitHub');
    for (const url of b.githubUrls) lines.push(`- ${url}`);
    lines.push('');
  }

  // ── Wikilinks to wiki pages ─────────────────────────────────────────
  const refs: string[] = [];
  if (b.primaryCategory) refs.push(`[[categories/${slug(b.primaryCategory)}]]`);
  if (b.primaryDomain) refs.push(`[[domains/${slug(b.primaryDomain)}]]`);
  if (b.authorHandle) refs.push(`[[entities/${slug(b.authorHandle)}]]`);

  if (refs.length > 0) {
    lines.push('## Related');
    for (const ref of refs) lines.push(`- ${ref}`);
    lines.push('');
  }

  // ── Source ──────────────────────────────────────────────────────────
  lines.push(`[Original tweet](${b.url})`);
  lines.push('');

  return lines.join('\n');
}

export async function exportBookmarks(options: ExportOptions = {}): Promise<ExportResult> {
  const progress = options.onProgress ?? ((s: string) => fs.writeSync(2, s + '\n'));
  const startTime = Date.now();

  await ensureDir(bookmarksDir());

  const total = await countBookmarks();
  progress(options.changed ? `Exporting changed bookmarks to markdown...` : `Exporting ${total} bookmarks to markdown...`);

  let exported = 0;
  let skipped = 0;
  const batchSize = 500;
  let offset = 0;

  while (offset < total) {
    const bookmarks = await listBookmarks({ limit: batchSize, offset, sort: 'desc' });
    if (bookmarks.length === 0) break;

    for (const b of bookmarks) {
      const filename = bookmarkFilename(b);
      const filePath = path.join(bookmarksDir(), filename);

      if (!shouldExportBookmark(b, filePath, options)) {
        skipped++;
        continue;
      }

      const content = buildBookmarkMd(b);
      await writeMd(filePath, content);
      exported++;

      if (exported % 100 === 0) {
        progress(`  ${exported}/${total} exported...`);
      }
    }

    offset += bookmarks.length;
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  return { exported, skipped, total, elapsed };
}

// ── Canonical bookmark export (includes Raindrop) ────────────────────────

export interface ExportCanonicalOptions {
  outputDir?: string;
  source?: string;
  limit?: number;
  onProgress?: (status: string) => void;
}

export interface ExportCanonicalResult {
  exported: number;
  total: number;
  outputDir: string;
  elapsed: number;
}

function canonicalFilename(canonical: CanonicalBookmarkListResult): string {
  const date = exportDate(canonical.lastSavedAt ?? canonical.firstSavedAt) ?? 'undated';
  const domain = canonical.primaryDomain ? slug(canonical.primaryDomain) : 'unknown';
  const titleSlug = slug((canonical.displayTitle ?? canonical.canonicalUrl ?? canonical.id).slice(0, 50));
  return `${date}-${domain}-${titleSlug}.md`;
}

function findRaindropRecord(
  sources: CanonicalSourceRow[],
  raindropMap: Map<string, RaindropRecord>,
): RaindropRecord | null {
  for (const source of sources) {
    if (source.source !== 'raindrop') continue;
    const record = raindropMap.get(source.sourceUrl);
    if (record) return record;
    // fallback: try by normalized URL
    for (const [url, rec] of raindropMap) {
      if (source.sourceUrl === url) return rec;
    }
  }
  return null;
}

function findGitHubStarRecord(
  sources: CanonicalSourceRow[],
  githubStarsMap: Map<string, GitHubStarRecord>,
): GitHubStarRecord | null {
  for (const source of sources) {
    if (source.source !== 'github-stars') continue;
    const byId = githubStarsMap.get(source.sourceItemId);
    if (byId) return byId;
    const byUrl = githubStarsMap.get(source.sourceUrl);
    if (byUrl) return byUrl;
  }
  return null;
}

function escapeYaml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function yamlQuoted(value: string): string {
  return `"${escapeYaml(value)}"`;
}

function yamlList(values: string[]): string[] {
  return values.map((value) => `  - ${yamlQuoted(value)}`);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function buildCanonicalBookmarkMd(
  canonical: CanonicalBookmarkListResult,
  sources: CanonicalSourceRow[],
  raindropRecord: RaindropRecord | null,
  githubStarRecord: GitHubStarRecord | null,
): string {
  const lines: string[] = [];
  const title = githubStarRecord?.fullName ?? canonical.displayTitle ?? 'Untitled';
  const url = githubStarRecord?.htmlUrl ?? canonical.canonicalUrl ?? '#';
  const categories = canonical.categories ? canonical.categories.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const domains = canonical.domains ? canonical.domains.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const sourceLabels = [...new Set(sources.map((source) => source.source))];

  // ── Frontmatter ─────────────────────────────────────────────────────
  lines.push('---');
  lines.push(`title: ${yamlQuoted(title)}`);
  lines.push(`url: ${yamlQuoted(url)}`);
  if (!githubStarRecord && canonical.primaryDomain) lines.push(`domain: ${canonical.primaryDomain}`);
  if (canonical.primaryCategory) lines.push(`category: ${canonical.primaryCategory}`);
  if (categories.length > 0) lines.push(`categories: [${categories.join(', ')}]`);
  if (domains.length > 0) lines.push(`domains: [${domains.join(', ')}]`);

  const raindropSource = sources.find((s) => s.source === 'raindrop');
  const xSource = sources.find((s) => s.source === 'x');
  const youtubeSource = sources.find((s) => s.source === 'youtube');
  const githubStarsSource = sources.find((s) => s.source === 'github-stars');

  if (githubStarsSource && githubStarRecord) {
    lines.push(`source: github-stars`);
    lines.push(`sources:`);
    lines.push(...yamlList(sourceLabels));
    lines.push(`item_type: github_repository`);
    lines.push(`repo: ${yamlQuoted(githubStarRecord.fullName)}`);
    lines.push(`owner: ${yamlQuoted(githubStarRecord.owner)}`);
    lines.push(`name: ${yamlQuoted(githubStarRecord.name)}`);
    lines.push(`github_id: ${yamlQuoted(String(githubStarRecord.id))}`);
    if (githubStarRecord.description) lines.push(`description: ${yamlQuoted(githubStarRecord.description)}`);
    if (githubStarRecord.language) lines.push(`language: ${yamlQuoted(githubStarRecord.language)}`);
    if (githubStarRecord.topics.length) {
      lines.push(`topics:`);
      lines.push(...yamlList(githubStarRecord.topics));
    }
    lines.push(`stargazers_count: ${githubStarRecord.stargazersCount}`);
    lines.push(`forks_count: ${githubStarRecord.forksCount}`);
    lines.push(`open_issues_count: ${githubStarRecord.openIssuesCount}`);
    lines.push(`is_archived: ${githubStarRecord.isArchived}`);
    lines.push(`is_fork: ${githubStarRecord.isFork}`);
    if (githubStarRecord.defaultBranch) lines.push(`default_branch: ${yamlQuoted(githubStarRecord.defaultBranch)}`);
    if (canonical.firstSavedAt) lines.push(`saved_at: ${yamlQuoted(canonical.firstSavedAt)}`);
    if (githubStarRecord.starredAt) lines.push(`starred_at: ${yamlQuoted(githubStarRecord.starredAt)}`);
    if (githubStarRecord.pushedAt) lines.push(`pushed_at: ${yamlQuoted(githubStarRecord.pushedAt)}`);
    if (githubStarRecord.updatedAt) lines.push(`updated_at: ${yamlQuoted(githubStarRecord.updatedAt)}`);
    lines.push(`synced_at: ${yamlQuoted(githubStarRecord.syncedAt)}`);
    lines.push(`domain: github.com`);
  } else if (raindropSource) {
    lines.push(`source: raindrop`);
    lines.push(`sources:`);
    lines.push(...yamlList(sourceLabels));
    if (raindropRecord) {
      lines.push(`raindrop_id: ${raindropRecord.id}`);
      if (raindropRecord.collectionPath?.length) {
        lines.push(`collection: "${escapeYaml(raindropRecord.collectionPath.join(' / '))}"`);
      }
      if (raindropRecord.tags?.length) {
        lines.push(`tags: [${raindropRecord.tags.map((t) => `"${escapeYaml(t)}"`).join(', ')}]`);
      }
      if (raindropRecord.important === true) {
        lines.push(`starred: true`);
      }
      if (raindropRecord.highlights?.length) {
        lines.push(`highlights_count: ${raindropRecord.highlights.length}`);
      }
    }
  } else if (xSource) {
    lines.push(`source: x`);
    lines.push(`sources:`);
    lines.push(...yamlList(sourceLabels));
  } else if (youtubeSource) {
    lines.push(`source: youtube`);
    lines.push(`sources:`);
    lines.push(...yamlList(sourceLabels));
  }

  if (!githubStarRecord && canonical.firstSavedAt) lines.push(`saved_at: ${exportDate(canonical.firstSavedAt)}`);
  lines.push('---');
  lines.push('');

  // ── Title ───────────────────────────────────────────────────────────
  lines.push(`# ${title}`);
  lines.push('');

  if (githubStarRecord) {
    if (githubStarRecord.description) {
      lines.push('> ' + githubStarRecord.description.replace(/\n/g, '\n> '));
      lines.push('');
    }

    lines.push('## Repository context');
    lines.push(`- Repository: [${githubStarRecord.fullName}](${githubStarRecord.htmlUrl})`);
    lines.push(`- Owner: [${githubStarRecord.owner}](https://github.com/${githubStarRecord.owner})`);
    if (githubStarRecord.language) lines.push(`- Primary language: ${githubStarRecord.language}`);
    if (githubStarRecord.topics.length) lines.push(`- Topics: ${githubStarRecord.topics.map((topic) => `\`${topic}\``).join(', ')}`);
    if (githubStarRecord.defaultBranch) lines.push(`- Default branch: \`${githubStarRecord.defaultBranch}\``);
    lines.push(`- Status: ${githubStarRecord.isArchived ? 'archived' : 'not archived'}; ${githubStarRecord.isFork ? 'fork' : 'not a fork'}`);
    lines.push('');

    lines.push('## Signals');
    if (githubStarRecord.starredAt) lines.push(`- Starred: ${githubStarRecord.starredAt}`);
    lines.push(`- Stars: ${formatNumber(githubStarRecord.stargazersCount)}`);
    lines.push(`- Forks: ${formatNumber(githubStarRecord.forksCount)}`);
    lines.push(`- Open issues: ${formatNumber(githubStarRecord.openIssuesCount)}`);
    if (githubStarRecord.pushedAt) lines.push(`- Last pushed: ${githubStarRecord.pushedAt}`);
    if (githubStarRecord.updatedAt) lines.push(`- Last updated: ${githubStarRecord.updatedAt}`);
    lines.push('');

    lines.push('## Links');
    lines.push(`- [Repository](${githubStarRecord.htmlUrl})`);
    lines.push(`- [Owner](https://github.com/${githubStarRecord.owner})`);
    if (githubStarRecord.homepageUrl) lines.push(`- [Homepage](${githubStarRecord.homepageUrl})`);
    if (githubStarRecord.defaultBranch) lines.push(`- [Default branch](${githubStarRecord.htmlUrl}/tree/${githubStarRecord.defaultBranch})`);
    lines.push(`- [Issues](${githubStarRecord.htmlUrl}/issues)`);
    lines.push('');

    lines.push('## Related');
    lines.push(`- [[domains/github-com]]`);
    lines.push(`- [[entities/${slug(`github-${githubStarRecord.owner}`)}]]`);
    lines.push('');

    return lines.join('\n');
  }

  // ── Excerpt (Raindrop) ──────────────────────────────────────────────
  if (raindropRecord?.excerpt) {
    lines.push('> ' + raindropRecord.excerpt.replace(/\n/g, '\n> '));
    lines.push('');
  }

  // ── Note (Raindrop) ─────────────────────────────────────────────────
  if (raindropRecord?.note) {
    lines.push('## Note');
    lines.push(raindropRecord.note);
    lines.push('');
  }

  // ── Highlights (Raindrop) ─────────────────────────────────────────
  if (raindropRecord?.highlights?.length) {
    lines.push('## Highlights');
    for (const h of raindropRecord.highlights) {
      const color = h.color ? `**${h.color}**: ` : '';
      lines.push(`- ${color}"${h.text}"`);
      if (h.note) {
        lines.push(`  - *Note: ${h.note}*`);
      }
    }
    lines.push('');
  }

  // ── Links ───────────────────────────────────────────────────────────
  const allLinks = new Set<string>();
  for (const s of sources) {
    if (s.sourceUrl) allLinks.add(s.sourceUrl);
    if (s.targetUrl) allLinks.add(s.targetUrl);
    for (const l of s.links) allLinks.add(l);
  }
  if (allLinks.size > 0) {
    lines.push('## Links');
    for (const link of allLinks) lines.push(`- ${link}`);
    lines.push('');
  }

  // ── Wikilinks to wiki pages ─────────────────────────────────────────
  const refs: string[] = [];
  if (canonical.primaryCategory) refs.push(`[[categories/${slug(canonical.primaryCategory)}]]`);
  if (canonical.primaryDomain) refs.push(`[[domains/${slug(canonical.primaryDomain)}]]`);

  if (refs.length > 0) {
    lines.push('## Related');
    for (const ref of refs) lines.push(`- ${ref}`);
    lines.push('');
  }

  // ── Source ──────────────────────────────────────────────────────────
  lines.push(`[Source](${url})`);
  lines.push('');

  return lines.join('\n');
}

export async function exportCanonicalBookmarks(
  options: ExportCanonicalOptions = {},
): Promise<ExportCanonicalResult> {
  const progress = options.onProgress ?? ((s: string) => fs.writeSync(2, s + '\n'));
  const startTime = Date.now();

  const outputDir = options.outputDir ?? path.join(mdDir(), 'bookmarks');
  await ensureDir(outputDir);

  // Load Raindrop records for enrichment
  let raindropMap = new Map<string, RaindropRecord>();
  try {
    const raindropRecords = await readJsonLines<RaindropRecord>(raindropBookmarksCachePath());
    for (const r of raindropRecords) {
      raindropMap.set(r.url, r);
    }
  } catch {
    // Raindrop cache may not exist yet
  }

  let githubStarsMap = new Map<string, GitHubStarRecord>();
  try {
    const githubStarRecords = await readJsonLines<GitHubStarRecord>(githubStarsCachePath());
    for (const r of githubStarRecords) {
      githubStarsMap.set(String(r.id), r);
      githubStarsMap.set(r.htmlUrl, r);
    }
  } catch {
    // GitHub stars cache may not exist yet
  }

  progress(`Exporting canonical bookmarks to ${outputDir}...`);

  let exported = 0;
  let offset = 0;
  const batchSize = 100;
  let hasMore = true;

  while (hasMore) {
    const limit = options.limit ? Math.min(batchSize, options.limit - exported) : batchSize;
    if (limit <= 0) break;

    const canonicals = await listCanonicalBookmarks({
      source: options.source,
      limit,
      offset,
    });

    if (canonicals.length === 0) break;

    for (const c of canonicals) {
      const sources = await getCanonicalBookmarkSources(c.id);
      const raindropRecord = findRaindropRecord(sources, raindropMap);
      const githubStarRecord = findGitHubStarRecord(sources, githubStarsMap);
      const content = buildCanonicalBookmarkMd(c, sources, raindropRecord, githubStarRecord);
      const filename = canonicalFilename(c);
      const filePath = path.join(outputDir, filename);
      await writeMd(filePath, content);
      exported++;
    }

    if (options.limit && exported >= options.limit) {
      hasMore = false;
    } else {
      offset += canonicals.length;
      hasMore = canonicals.length === limit;
    }

    if (exported % 100 === 0) {
      progress(`  ${exported} exported...`);
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  progress(`Exported ${exported} bookmarks to ${outputDir} (${elapsed}s)`);
  return { exported, total: exported, outputDir, elapsed };
}
