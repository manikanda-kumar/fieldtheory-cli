import crypto from 'node:crypto';
import path from 'node:path';
import type { Database } from 'sql.js';
import { acquireDbLock, openDb, releaseDbLock, saveDb } from './db.js';
import { listFiles, pathExists, readJson, readJsonLines } from './fs.js';
import { dataDir, twitterBookmarksCachePath, twitterBookmarksIndexPath, xListsDir } from './paths.js';
import type { BookmarkRecord } from './types.js';
import { dedupeKeyForUrl, dedupeKeyForXBookmark } from './url-normalize.js';
import { sanitizeFtsQuery } from './bookmarks-db.js';
import { classifyBookmarkInput } from './bookmark-classify.js';
import {
  buildCategoryPrompt,
  parseCategoryResponse,
  BATCH_SIZE,
  type CategoryPromptItem,
} from './bookmark-classify-llm.js';
import { invokeEngineAsync, type ResolvedEngine } from './engine.js';
import { raindropBookmarksCachePath } from './raindrop/paths.js';
import type { RaindropRecord } from './raindrop/types.js';
import { githubStarsCachePath } from './github-stars/paths.js';
import type { GitHubStarRecord } from './github-stars/types.js';
import { projectsCachePath } from './projects/paths.js';
import type { ProjectRecord } from './projects/types.js';
import { followingCachePath } from './following/paths.js';
import { isFollowingSnapshotComplete } from './following/db.js';
import type { FollowingRecord } from './following/types.js';
import type { ListMemberRecord, XListMembersDigest } from './x-list-members.js';

export interface CanonicalRebuildResult {
  dbPath: string;
  sourceCount: number;
  canonicalCount: number;
}

export interface CanonicalSearchResult {
  id: string;
  canonicalUrl: string | null;
  displayTitle: string | null;
  searchText: string;
  sourceCount: number;
  sources: string[];
  score: number;
}

export interface CanonicalBookmarkListResult {
  id: string;
  canonicalUrl: string | null;
  displayTitle: string | null;
  searchText: string;
  sourceCount: number;
  firstSavedAt: string | null;
  lastSavedAt: string | null;
  sources: string[];
  categories: string | null;
  primaryCategory: string | null;
  domains: string | null;
  primaryDomain: string | null;
  authorHandle?: string;
}

export interface CanonicalSample {
  id: string;
  url: string;
  text: string;
  authorHandle?: string;
  categories: string;
  domains: string;
  sources: string[];
  githubUrls?: string;
  links?: string;
}

export interface ListCanonicalBookmarksOptions {
  query?: string;
  source?: string;
  category?: string;
  domain?: string;
  author?: string;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
}

export type CanonicalBookmarkFormatResult = CanonicalSearchResult | CanonicalBookmarkListResult;

interface CanonicalSourceInput {
  id: string;
  source: string;
  profile: string | null;
  sourceItemId: string;
  sourceUrl: string;
  targetUrl: string | null;
  dedupeKey: string;
  title: string | null;
  text: string | null;
  authorHandle: string | null;
  savedAt: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  folderPath: string[];
  links: string[];
  contentPath: string | null;
  metadata: Record<string, unknown> | null;
}

interface CanonicalGroup {
  id: string;
  dedupeKey: string;
  canonicalUrl: string | null;
  displayTitle: string | null;
  searchText: string;
  sourceCount: number;
  firstSavedAt: string | null;
  lastSavedAt: string | null;
  sources: string[];
}

interface PreservedCanonicalFields {
  categories: string | null;
  primaryCategory: string | null;
  domains: string | null;
  primaryDomain: string | null;
}

export interface RebuildCanonicalOptions {
  // Browser bookmark sync has been replaced by Raindrop; this interface is kept
  // empty for backward compatibility and may be removed in a future cleanup.
}

export interface SearchCanonicalOptions {
  query: string;
  limit?: number;
}

export interface YoutubeSourceVideoInput {
  videoId: string;
  title: string;
  tldr: string;
  keyPoints?: string[];
  chapters?: Array<{ tSec: number; label: string; summary: string }>;
  actionItems?: string[];
  topics: string[];
  notePath?: string | null;
  channel?: string | null;
  durationSec?: number | null;
  videoType?: string | null;
  published?: string | null;
}

function initCanonicalSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS bookmark_sources (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    profile TEXT,
    source_item_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    target_url TEXT,
    dedupe_key TEXT NOT NULL,
    title TEXT,
    text TEXT,
    author_handle TEXT,
    saved_at TEXT,
    created_at TEXT,
    modified_at TEXT,
    folder_path_json TEXT,
    links_json TEXT,
    content_path TEXT,
    metadata_json TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    canonical_id TEXT
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmark_sources_dedupe_key ON bookmark_sources(dedupe_key)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmark_sources_canonical_id ON bookmark_sources(canonical_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmark_sources_source ON bookmark_sources(source, profile)`);
  ensureSourceColumn(db, 'content_path', 'TEXT');
  ensureSourceColumn(db, 'metadata_json', 'TEXT');

  db.run(`CREATE TABLE IF NOT EXISTS canonical_bookmarks (
    id TEXT PRIMARY KEY,
    dedupe_key TEXT UNIQUE NOT NULL,
    canonical_url TEXT,
    display_title TEXT,
    search_text TEXT NOT NULL,
    categories TEXT,
    primary_category TEXT,
    domains TEXT,
    primary_domain TEXT,
    source_count INTEGER NOT NULL,
    first_saved_at TEXT,
    last_saved_at TEXT,
    sources_json TEXT
  )`);

  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS canonical_bookmarks_fts USING fts5(
    display_title,
    search_text,
    content=canonical_bookmarks,
    content_rowid=rowid,
    tokenize='porter unicode61'
  )`);

  ensureCanonicalColumn(db, 'categories', 'TEXT');
  ensureCanonicalColumn(db, 'primary_category', 'TEXT');
  ensureCanonicalColumn(db, 'domains', 'TEXT');
  ensureCanonicalColumn(db, 'primary_domain', 'TEXT');
}

function tableColumnExists(db: Database, table: string, column: string): boolean {
  const rows = db.exec(`PRAGMA table_info(${table})`);
  const columns = rows[0]?.values ?? [];
  return columns.some((row) => row[1] === column);
}

function canonicalColumnExists(db: Database, column: string): boolean {
  return tableColumnExists(db, 'canonical_bookmarks', column);
}

function sourceColumnExists(db: Database, column: string): boolean {
  return tableColumnExists(db, 'bookmark_sources', column);
}

function ensureSourceColumn(db: Database, column: string, definition: string): void {
  if (sourceColumnExists(db, column)) return;
  db.run(`ALTER TABLE bookmark_sources ADD COLUMN ${column} ${definition}`);
}

function ensureCanonicalColumn(db: Database, column: string, definition: string): void {
  if (canonicalColumnExists(db, column)) return;
  db.run(`ALTER TABLE canonical_bookmarks ADD COLUMN ${column} ${definition}`);
}

function canonicalIdForDedupeKey(dedupeKey: string): string {
  return `canonical:${crypto.createHash('sha256').update(dedupeKey).digest('hex')}`;
}

function compactText(parts: Array<string | null | undefined | string[]>): string {
  const values = parts
    .flatMap((part) => Array.isArray(part) ? part : [part])
    .map((part) => typeof part === 'string' ? part.trim() : '')
    .filter(Boolean);
  return [...new Set(values)].join('\n');
}

function capCompactText(parts: string[], maxChars: number): string | null {
  const seen = new Set<string>();
  const kept: string[] = [];
  let used = 0;

  for (const part of parts) {
    const text = part.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const separator = kept.length ? 1 : 0;
    const remaining = maxChars - used - separator;
    if (remaining <= 0) break;
    const value = text.length > remaining ? text.slice(0, remaining).trimEnd() : text;
    if (!value) break;
    kept.push(value);
    used += value.length + separator;
    if (text.length > remaining) break;
  }

  return kept.length ? kept.join('\n') : null;
}

function parseSources(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function mapCanonicalSamples(rows: unknown[][]): CanonicalSample[] {
  return rows.map((row) => ({
    id: row[0] as string,
    url: (row[1] as string | null) ?? '',
    text: `${(row[2] as string | null) ?? ''}. ${(row[3] as string | null) ?? ''}`,
    categories: (row[4] as string | null) ?? '',
    domains: (row[5] as string | null) ?? '',
    sources: parseSources(row[6]),
  }));
}

export async function getCanonicalCategoryCounts(existingDb?: Database): Promise<Record<string, number>> {
  const db = existingDb ?? await openDb(twitterBookmarksIndexPath());
  try {
    initCanonicalSchema(db);
    const rows = db.exec(`SELECT primary_category, COUNT(*) FROM canonical_bookmarks
      WHERE primary_category IS NOT NULL AND primary_category != '' AND primary_category != 'unclassified'
      GROUP BY primary_category`);
    return Object.fromEntries((rows[0]?.values ?? []).map((row) => [row[0] as string, row[1] as number]));
  } finally {
    if (!existingDb) db.close();
  }
}

export async function getCanonicalDomainCounts(existingDb?: Database): Promise<Record<string, number>> {
  const db = existingDb ?? await openDb(twitterBookmarksIndexPath());
  try {
    initCanonicalSchema(db);
    const rows = db.exec(`SELECT primary_domain, COUNT(*) FROM canonical_bookmarks
      WHERE primary_domain IS NOT NULL AND primary_domain != '' GROUP BY primary_domain`);
    return Object.fromEntries((rows[0]?.values ?? []).map((row) => [row[0] as string, row[1] as number]));
  } finally {
    if (!existingDb) db.close();
  }
}

export async function getCanonicalSourceCounts(existingDb?: Database): Promise<Record<string, number>> {
  const db = existingDb ?? await openDb(twitterBookmarksIndexPath());
  try {
    initCanonicalSchema(db);
    const rows = db.exec('SELECT source, COUNT(DISTINCT canonical_id) FROM bookmark_sources GROUP BY source');
    return Object.fromEntries((rows[0]?.values ?? []).map((row) => [row[0] as string, row[1] as number]));
  } finally {
    if (!existingDb) db.close();
  }
}

async function sampleCanonical(
  where: string,
  params: Array<string | number>,
  existingDb?: Database,
): Promise<CanonicalSample[]> {
  const db = existingDb ?? await openDb(twitterBookmarksIndexPath());
  try {
    initCanonicalSchema(db);
    const rows = db.exec(`SELECT c.id, c.canonical_url, c.display_title, c.search_text,
      c.categories, c.domains, c.sources_json FROM canonical_bookmarks c ${where}`, params);
    return mapCanonicalSamples(rows[0]?.values ?? []);
  } finally {
    if (!existingDb) db.close();
  }
}

export function sampleCanonicalByCategory(category: string, limit: number, existingDb?: Database): Promise<CanonicalSample[]> {
  return sampleCanonical(`WHERE c.primary_category = ? COLLATE NOCASE OR c.categories LIKE ?
    ORDER BY RANDOM() LIMIT ?`, [category, `%${category}%`, limit], existingDb);
}

export function sampleCanonicalByDomain(domain: string, limit: number, existingDb?: Database): Promise<CanonicalSample[]> {
  return sampleCanonical(`WHERE c.primary_domain = ? COLLATE NOCASE OR c.domains LIKE ?
    ORDER BY RANDOM() LIMIT ?`, [domain, `%${domain}%`, limit], existingDb);
}

export function sampleCanonicalBySource(source: string, limit: number, existingDb?: Database): Promise<CanonicalSample[]> {
  return sampleCanonical(`WHERE EXISTS (SELECT 1 FROM bookmark_sources s
      WHERE s.canonical_id = c.id AND s.source = ?)
    ORDER BY c.last_saved_at DESC LIMIT ?`, [source, limit], existingDb);
}

function parseJsonStringArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : null;
  } catch {
    return null;
  }
}

function hostnameForUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function xSourceFromRecord(record: BookmarkRecord): CanonicalSourceInput {
  return {
    id: `x:${record.id}`,
    source: 'x',
    profile: null,
    sourceItemId: record.tweetId,
    sourceUrl: record.url,
    targetUrl: record.links?.[0] ?? null,
    dedupeKey: dedupeKeyForXBookmark({ tweetId: record.tweetId, links: record.links }),
    title: record.articleTitle ?? null,
    text: record.articleText ? compactText([record.text, record.articleText]) : record.text,
    authorHandle: record.authorHandle ?? null,
    savedAt: record.bookmarkedAt ?? record.postedAt ?? record.syncedAt ?? null,
    createdAt: record.postedAt ?? null,
    modifiedAt: null,
    folderPath: record.folderNames ?? [],
    links: record.links ?? [],
    contentPath: null,
    metadata: null,
  };
}

export function raindropSourceFromRecord(record: RaindropRecord): CanonicalSourceInput | null {
  let dedupeKey: string;
  try {
    dedupeKey = dedupeKeyForUrl(record.url);
  } catch {
    return null;
  }

  const folderPaths = record.collectionPath?.length
    ? [record.collectionPath.join(' / ')]
    : record.collectionName
      ? [record.collectionName]
      : [];

  // Combine excerpt + note + highlights text for search_text enrichment
  const textParts: string[] = [];
  if (record.excerpt) textParts.push(record.excerpt);
  if (record.note) textParts.push(record.note);
  if (record.highlights?.length) {
    for (const h of record.highlights) {
      textParts.push(h.text);
      if (h.note) textParts.push(h.note);
    }
  }

  return {
    id: `raindrop:${record.id}`,
    source: 'raindrop',
    profile: null,
    sourceItemId: String(record.id),
    sourceUrl: record.url,
    targetUrl: null,
    dedupeKey,
    title: record.title,
    text: textParts.join('\n\n') || null,
    authorHandle: record.domain || null,
    savedAt: record.createdAt,
    createdAt: record.createdAt,
    modifiedAt: record.updatedAt ?? null,
    folderPath: folderPaths,
    links: record.links ?? [],
    contentPath: null,
    metadata: null,
  };
}

export function githubStarsSourceFromRecord(record: GitHubStarRecord): CanonicalSourceInput | null {
  let dedupeKey: string;
  try {
    dedupeKey = dedupeKeyForUrl(record.htmlUrl);
  } catch {
    return null;
  }

  return {
    id: `github-stars:${record.id}`,
    source: 'github-stars',
    profile: null,
    sourceItemId: String(record.id),
    sourceUrl: record.htmlUrl,
    targetUrl: null,
    dedupeKey,
    title: record.fullName,
    text: compactText([
      record.fullName,
      record.description,
      record.language,
      record.topics,
      record.owner,
    ]),
    authorHandle: record.owner,
    savedAt: record.starredAt,
    createdAt: null,
    modifiedAt: record.updatedAt ?? record.pushedAt,
    folderPath: record.language ? ['GitHub Stars', record.language] : ['GitHub Stars'],
    links: [
      `https://github.com/${record.owner}`,
      record.homepageUrl,
      `${record.htmlUrl}/issues`,
      record.defaultBranch ? `${record.htmlUrl}/tree/${record.defaultBranch}` : null,
    ].filter((link): link is string => Boolean(link)),
    contentPath: null,
    metadata: null,
  };
}

function isNormalizedGithubRepoUrl(value: string | undefined): value is string {
  if (!value) return false;
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+$/i.test(value);
}

export function projectSourceFromRecord(record: ProjectRecord): CanonicalSourceInput {
  // No scannedAt fallback: a rescan must not make commit-less repos look
  // newly saved, or every daily collection window fills with stale projects.
  const savedAt = record.lastCommitAt ?? null;
  const promptText = capCompactText((record.recentPrompts ?? []).map((prompt) => prompt.text), 4000);
  const dedupeKey = isNormalizedGithubRepoUrl(record.remoteUrl)
    ? dedupeKeyForUrl(record.remoteUrl)
    : `project:${record.repo}`;

  return {
    id: `project:${record.repo}`,
    source: 'project',
    profile: null,
    sourceItemId: record.repo,
    sourceUrl: record.remoteUrl ?? record.path,
    targetUrl: null,
    dedupeKey,
    title: record.repo,
    text: compactText([
      record.repo,
      record.description,
      record.goalNowNext?.goal,
      record.goalNowNext?.now,
      record.goalNowNext?.next,
      record.recentCommits.map((commit) => commit.subject),
      promptText,
    ]),
    authorHandle: null,
    savedAt,
    createdAt: savedAt,
    modifiedAt: record.scannedAt,
    folderPath: ['Projects'],
    links: record.remoteUrl ? [record.remoteUrl] : [],
    contentPath: null,
    metadata: {
      repo: record.repo,
      path: record.path,
      ...(record.remoteUrl ? { remoteUrl: record.remoteUrl } : {}),
      pendingFiles: record.pendingFiles,
      unpushedCommits: record.unpushedCommits,
      promptCount: record.recentPrompts?.length ?? 0,
    },
  };
}

function xProfileUrl(handle: string): string {
  return `https://x.com/${encodeURIComponent(handle.replace(/^@/, ''))}`;
}

function xPersonSource(
  record: Pick<ListMemberRecord, 'userId' | 'handle' | 'name' | 'bio' | 'profileImageUrl' | 'followerCount' | 'followingCount' | 'verified' | 'syncedAt'> &
    Partial<Pick<FollowingRecord, 'domains' | 'primaryDomain' | 'expertise' | 'expertiseSummary' | 'bookmarkOverlap'>>,
  source: 'x-following' | 'x-list-members',
  profile: string | null,
): CanonicalSourceInput | null {
  const handle = record.handle.replace(/^@/, '').trim();
  const userId = record.userId.trim();
  if (!handle || !userId) return null;

  const sourceUrl = xProfileUrl(handle);
  return {
    id: source === 'x-following'
      ? `x-following:${userId}`
      : `x-list-member:${profile ?? 'unknown'}:${userId}`,
    source,
    profile,
    sourceItemId: userId,
    sourceUrl,
    targetUrl: null,
    // Profiles are people, not URL bookmarks. Stable X ids let a renamed handle
    // merge cleanly across the following roster and every X-list membership.
    dedupeKey: `x-person:${userId}`,
    title: record.name ? `${record.name} (@${handle})` : `@${handle}`,
    text: compactText([
      `X profile @${handle}`,
      record.name,
      record.bio,
      record.domains,
      record.primaryDomain,
      record.expertise,
      record.expertiseSummary,
    ]),
    authorHandle: handle,
    // A roster refresh is not a newly saved knowledge item. Leaving this null
    // makes profiles queryable but keeps them out of the daily activity window.
    savedAt: null,
    createdAt: null,
    modifiedAt: record.syncedAt,
    folderPath: source === 'x-following'
      ? ['X People', 'Following']
      : ['X Lists', profile ?? 'Unknown list', 'Members'],
    links: [sourceUrl],
    contentPath: null,
    metadata: {
      userId,
      handle,
      ...(record.profileImageUrl ? { profileImageUrl: record.profileImageUrl } : {}),
      ...(record.followerCount != null ? { followerCount: record.followerCount } : {}),
      ...(record.followingCount != null ? { followingCount: record.followingCount } : {}),
      ...(record.verified != null ? { verified: record.verified } : {}),
      ...(record.bookmarkOverlap != null ? { bookmarkOverlap: record.bookmarkOverlap } : {}),
      ...(source === 'x-list-members' && profile ? { listId: profile } : {}),
    },
  };
}

export function followingSourceFromRecord(record: FollowingRecord): CanonicalSourceInput | null {
  return xPersonSource(record, 'x-following', null);
}

export function xListMemberSourceFromRecord(record: ListMemberRecord, listId: string): CanonicalSourceInput | null {
  return xPersonSource(record, 'x-list-members', listId);
}

async function readLatestXListMemberDigests(): Promise<XListMembersDigest[]> {
  const files = await listFiles(xListsDir());
  const digests: XListMembersDigest[] = [];
  for (const file of files) {
    const match = file.match(/^(\d+)-members-latest\.json$/);
    if (!match) continue;
    try {
      const digest = await readJson<XListMembersDigest>(path.join(xListsDir(), file));
      if (String(digest.listId) !== match[1] || !Array.isArray(digest.members)) continue;
      digests.push(digest);
    } catch {
      // A partial or malformed snapshot must not block every other source.
    }
  }
  return digests;
}

function youtubeSourceFromVideo(video: YoutubeSourceVideoInput, savedAt: string): CanonicalSourceInput {
  const sourceUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
  const chapterText = video.chapters?.map((chapter) => compactText([
    chapter.label,
    chapter.summary,
  ])) ?? [];
  const metadata: Record<string, unknown> = {
    videoId: video.videoId,
    ...(video.channel ? { channel: video.channel } : {}),
    ...(video.durationSec != null ? { durationSec: video.durationSec } : {}),
    ...(video.videoType ? { videoType: video.videoType } : {}),
    ...(video.chapters?.length ? { chapters: video.chapters } : {}),
    ...(video.actionItems?.length ? { actionItems: video.actionItems } : {}),
  };
  return {
    id: `youtube:${video.videoId}`,
    source: 'youtube',
    profile: null,
    sourceItemId: video.videoId,
    sourceUrl,
    targetUrl: null,
    dedupeKey: dedupeKeyForUrl(sourceUrl),
    title: video.title,
    text: compactText([video.tldr, video.keyPoints, chapterText, video.actionItems, video.topics, video.channel]),
    authorHandle: video.channel ?? null,
    savedAt,
    createdAt: video.published ?? null,
    modifiedAt: null,
    folderPath: video.topics.length ? ['YouTube', ...video.topics] : ['YouTube'],
    links: [],
    contentPath: video.notePath ?? null,
    metadata,
  };
}

function readYoutubeSourcesFromDb(db: Database): CanonicalSourceInput[] {
  const rows = db.exec(
    `SELECT id, source, profile, source_item_id, source_url, target_url, dedupe_key,
            title, text, author_handle, saved_at, created_at, modified_at,
            folder_path_json, links_json, content_path, metadata_json
     FROM bookmark_sources
     WHERE source = 'youtube' AND active = 1`,
  );

  return (rows[0]?.values ?? []).map((row) => ({
    id: row[0] as string,
    source: row[1] as string,
    profile: (row[2] as string) ?? null,
    sourceItemId: row[3] as string,
    sourceUrl: row[4] as string,
    targetUrl: (row[5] as string) ?? null,
    dedupeKey: row[6] as string,
    title: (row[7] as string) ?? null,
    text: (row[8] as string) ?? null,
    authorHandle: (row[9] as string) ?? null,
    savedAt: (row[10] as string) ?? null,
    createdAt: (row[11] as string) ?? null,
    modifiedAt: (row[12] as string) ?? null,
    folderPath: parseJsonStringArray(row[13]),
    links: parseJsonStringArray(row[14]),
    contentPath: (row[15] as string) ?? null,
    metadata: parseJsonObject(row[16]),
  }));
}

function buildCanonicalGroup(dedupeKey: string, sources: CanonicalSourceInput[]): CanonicalGroup {
  const id = canonicalIdForDedupeKey(dedupeKey);
  const browserSource = sources.find((source) => source.source !== 'x' && source.sourceUrl);
  const linkSource = sources.find((source) => source.targetUrl);
  const canonicalUrl = browserSource?.sourceUrl ?? linkSource?.targetUrl ?? sources[0]?.sourceUrl ?? null;
  const displayTitle =
    sources.find((source) => source.source !== 'x' && source.title)?.title ??
    sources.find((source) => source.title)?.title ??
    sources.find((source) => source.text)?.text?.slice(0, 120) ??
    canonicalUrl;
  const savedDates = sources
    .map((source) => source.savedAt)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .sort();
  const sourceLabels = [...new Set(sources.map((source) => source.profile ? `${source.source}:${source.profile}` : source.source))];

  return {
    id,
    dedupeKey,
    canonicalUrl,
    displayTitle,
    searchText: compactText(sources.flatMap((source) => [
      source.title,
      source.text,
      source.sourceUrl,
      source.targetUrl,
      source.folderPath,
      source.links,
      source.authorHandle,
    ])),
    sourceCount: sources.length,
    firstSavedAt: savedDates[0] ?? null,
    lastSavedAt: savedDates[savedDates.length - 1] ?? null,
    sources: sourceLabels,
  };
}

const INSERT_SOURCE_SQL = `INSERT INTO bookmark_sources (
  id, source, profile, source_item_id, source_url, target_url, dedupe_key,
  title, text, author_handle, saved_at, created_at, modified_at,
  folder_path_json, links_json, content_path, metadata_json, active, canonical_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`;

function sourceInsertParams(source: CanonicalSourceInput, canonicalId: string): Array<string | null> {
  return [
    source.id,
    source.source,
    source.profile,
    source.sourceItemId,
    source.sourceUrl,
    source.targetUrl,
    source.dedupeKey,
    source.title,
    source.text,
    source.authorHandle,
    source.savedAt,
    source.createdAt,
    source.modifiedAt,
    JSON.stringify(source.folderPath),
    JSON.stringify(source.links),
    source.contentPath,
    source.metadata ? JSON.stringify(source.metadata) : null,
    canonicalId,
  ];
}

function readPreservedCanonicalFields(db: Database): Map<string, PreservedCanonicalFields> {
  const preserved = new Map<string, PreservedCanonicalFields>();
  try {
    const rows = db.exec(
      `SELECT dedupe_key, categories, primary_category, domains, primary_domain
       FROM canonical_bookmarks`,
    );
    for (const row of rows[0]?.values ?? []) {
      preserved.set(row[0] as string, {
        categories: (row[1] as string) ?? null,
        primaryCategory: (row[2] as string) ?? null,
        domains: (row[3] as string) ?? null,
        primaryDomain: (row[4] as string) ?? null,
      });
    }
  } catch (error) {
    if (!isSchemaMissingError(error)) throw error;
    // Existing DB may not have canonical tables/columns yet.
  }
  return preserved;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isSchemaMissingError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes('no such table')
    || message.includes('no such column')
    || message.includes('has no column named');
}

const INSERT_CANONICAL_SQL = `INSERT INTO canonical_bookmarks (
  id, dedupe_key, canonical_url, display_title, search_text,
  categories, primary_category, domains, primary_domain,
  source_count, first_saved_at, last_saved_at, sources_json
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function canonicalInsertParams(group: CanonicalGroup, preserved?: PreservedCanonicalFields): Array<string | number | null> {
  return [
    group.id,
    group.dedupeKey,
    group.canonicalUrl,
    group.displayTitle,
    group.searchText,
    preserved?.categories ?? null,
    preserved?.primaryCategory ?? null,
    preserved?.domains ?? null,
    preserved?.primaryDomain ?? null,
    group.sourceCount,
    group.firstSavedAt,
    group.lastSavedAt,
    JSON.stringify(group.sources),
  ];
}

function mapSearchRow(row: unknown[]): CanonicalSearchResult {
  return {
    id: row[0] as string,
    canonicalUrl: (row[1] as string) ?? null,
    displayTitle: (row[2] as string) ?? null,
    searchText: row[3] as string,
    sourceCount: Number(row[4] ?? 0),
    sources: parseSources(row[5]),
    score: Number(row[6] ?? 0),
  };
}

function mapListRow(row: unknown[]): CanonicalBookmarkListResult {
  return {
    id: row[0] as string,
    canonicalUrl: (row[1] as string) ?? null,
    displayTitle: (row[2] as string) ?? null,
    searchText: row[3] as string,
    sourceCount: Number(row[4] ?? 0),
    firstSavedAt: (row[5] as string) ?? null,
    lastSavedAt: (row[6] as string) ?? null,
    sources: parseSources(row[7]),
    categories: (row[8] as string) ?? null,
    primaryCategory: (row[9] as string) ?? null,
    domains: (row[10] as string) ?? null,
    primaryDomain: (row[11] as string) ?? null,
    authorHandle: (row[12] as string) ?? undefined,
  };
}

export async function rebuildCanonicalIndex(_options: RebuildCanonicalOptions = {}): Promise<CanonicalRebuildResult> {
  const dbPath = twitterBookmarksIndexPath();
  const lock = await acquireDbLock(dbPath);
  const db = await openDb(dbPath);

  try {
    initCanonicalSchema(db);
    const preservedFields = readPreservedCanonicalFields(db);

    const sourceRows: CanonicalSourceInput[] = [];
    const xRecords = await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath());
    sourceRows.push(...xRecords.map(xSourceFromRecord));

    // Raindrop sources (replaces browser bookmarks)
    const raindropCachePath = raindropBookmarksCachePath();
    if (await pathExists(raindropCachePath)) {
      const raindropRecords = await readJsonLines<RaindropRecord>(raindropCachePath);
      const normalized = raindropRecords
        .map(raindropSourceFromRecord)
        .filter((row): row is CanonicalSourceInput => row !== null);
      sourceRows.push(...normalized);
    }

    const githubStarsPath = githubStarsCachePath();
    if (await pathExists(githubStarsPath)) {
      const githubStarRecords = await readJsonLines<GitHubStarRecord>(githubStarsPath);
      const normalized = githubStarRecords
        .map(githubStarsSourceFromRecord)
        .filter((row): row is CanonicalSourceInput => row !== null);
      sourceRows.push(...normalized);
    }

    const projectsPath = projectsCachePath();
    if (await pathExists(projectsPath)) {
      const projectRecords = await readJsonLines<ProjectRecord>(projectsPath);
      sourceRows.push(...projectRecords.map(projectSourceFromRecord));
    }

    const followingPath = followingCachePath();
    if (await isFollowingSnapshotComplete() && await pathExists(followingPath)) {
      const followingRecords = await readJsonLines<FollowingRecord>(followingPath);
      sourceRows.push(...followingRecords
        .map(followingSourceFromRecord)
        .filter((row): row is CanonicalSourceInput => row !== null));
    }

    for (const digest of await readLatestXListMemberDigests()) {
      sourceRows.push(...digest.members
        .map((member) => xListMemberSourceFromRecord(member, digest.listId))
        .filter((row): row is CanonicalSourceInput => row !== null));
    }

    sourceRows.push(...readYoutubeSourcesFromDb(db));

    const groups = new Map<string, CanonicalSourceInput[]>();
    for (const source of sourceRows) {
      const existing = groups.get(source.dedupeKey) ?? [];
      existing.push(source);
      groups.set(source.dedupeKey, existing);
    }
    const canonicalGroups = [...groups.entries()].map(([dedupeKey, sources]) => buildCanonicalGroup(dedupeKey, sources));
    const enrichmentSummaries = readEnrichmentSummaries(db);
    for (const group of canonicalGroups) {
      const summary = group.canonicalUrl ? enrichmentSummaries.get(group.canonicalUrl) : undefined;
      if (summary && !group.searchText.includes(` summary: ${summary}`)) {
        group.searchText = `${group.searchText} summary: ${summary}`.trim();
      }
    }

    db.run('BEGIN TRANSACTION');
    try {
      db.run('DELETE FROM bookmark_sources');
      db.run('DELETE FROM canonical_bookmarks');
      const canonicalStmt = db.prepare(INSERT_CANONICAL_SQL);
      const sourceStmt = db.prepare(INSERT_SOURCE_SQL);
      try {
        for (const group of canonicalGroups) {
          canonicalStmt.run(canonicalInsertParams(group, preservedFields.get(group.dedupeKey)));
          const groupSources = groups.get(group.dedupeKey) ?? [];
          for (const source of groupSources) sourceStmt.run(sourceInsertParams(source, group.id));
        }
      } finally {
        canonicalStmt.free();
        sourceStmt.free();
      }
      db.run(`INSERT INTO canonical_bookmarks_fts(canonical_bookmarks_fts) VALUES('rebuild')`);
      db.run('COMMIT');
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }

    saveDb(db, dbPath);
    return { dbPath, sourceCount: sourceRows.length, canonicalCount: canonicalGroups.length };
  } finally {
    db.close();
    releaseDbLock(lock);
  }
}

/** The enrichment cache is deliberately optional so older/empty databases still rebuild. */
function readEnrichmentSummaries(db: Database): Map<string, string> {
  try {
    const rows = db.exec(`SELECT url, summary FROM link_enrichment WHERE status = 'ok' AND summary IS NOT NULL`)[0]?.values ?? [];
    return new Map(rows
      .filter((row) => typeof row[0] === 'string' && typeof row[1] === 'string' && row[1].trim())
      .map((row) => [row[0] as string, (row[1] as string).trim()]));
  } catch (error) {
    if (!isSchemaMissingError(error)) throw error;
    return new Map();
  }
}

export async function upsertYoutubeVideosAsSources(videos: YoutubeSourceVideoInput[]): Promise<CanonicalRebuildResult> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  const savedAt = new Date().toISOString();

  try {
    initCanonicalSchema(db);
    db.run('BEGIN TRANSACTION');
    try {
      const sourceStmt = db.prepare(INSERT_SOURCE_SQL);
      try {
        for (const video of videos) {
          const source = youtubeSourceFromVideo(video, savedAt);
          db.run(`DELETE FROM bookmark_sources WHERE id = ?`, [source.id]);
          sourceStmt.run(sourceInsertParams(source, canonicalIdForDedupeKey(source.dedupeKey)));
        }
      } finally {
        sourceStmt.free();
      }
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }
    saveDb(db, dbPath);
  } finally {
    db.close();
  }

  return rebuildCanonicalIndex();
}

export async function searchCanonicalBookmarks(options: SearchCanonicalOptions): Promise<CanonicalSearchResult[]> {
  const db = await openDb(twitterBookmarksIndexPath());
  const query = options.query.trim();
  const ftsQuery = sanitizeFtsQuery(query);
  const limit = options.limit ?? 20;

  try {
    initCanonicalSchema(db);

    const rows = query
      ? db.exec(
        `SELECT c.id, c.canonical_url, c.display_title, c.search_text, c.source_count, c.sources_json,
                bm25(canonical_bookmarks_fts) AS score
         FROM canonical_bookmarks c
         JOIN canonical_bookmarks_fts ON canonical_bookmarks_fts.rowid = c.rowid
         WHERE canonical_bookmarks_fts MATCH ?
         ORDER BY score ASC
         LIMIT ?`,
        [ftsQuery, limit],
      )
      : db.exec(
        `SELECT c.id, c.canonical_url, c.display_title, c.search_text, c.source_count, c.sources_json,
                0 AS score
         FROM canonical_bookmarks c
         ORDER BY COALESCE(c.last_saved_at, c.first_saved_at, '') DESC, c.id ASC
         LIMIT ?`,
        [limit],
      );

    return (rows[0]?.values ?? []).map(mapSearchRow);
  } finally {
    db.close();
  }
}

export interface CanonicalRecentItem {
  id: string;
  canonicalUrl: string | null;
  displayTitle: string | null;
  searchText: string;
  sources: string[];
  firstSavedAt: string | null;
  lastSavedAt: string | null;
  primaryCategory: string | null;
  primaryDomain: string | null;
}

/** Parse the mixed timestamp formats stored in first_saved_at: ISO-8601 (with
 *  any offset) and Twitter's "Wed Sep 30 13:43:32 +0000 2020". String
 *  comparison is NOT safe across these — always compare parsed epochs. */
export function parseSavedAt(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export async function getCanonicalBookmarksSince(
  sinceIso: string,
  limit?: number,
  untilIso?: string,
  afterId?: string,
): Promise<CanonicalRecentItem[]> {
  const sinceMs = Date.parse(sinceIso);
  const untilMs = untilIso ? Date.parse(untilIso) : NaN;
  const db = await openDb(twitterBookmarksIndexPath());
  try {
    initCanonicalSchema(db);
    const rows = db.exec(
      `SELECT id, canonical_url, display_title, search_text, sources_json,
              first_saved_at, last_saved_at, primary_category, primary_domain
       FROM canonical_bookmarks
       WHERE first_saved_at IS NOT NULL`,
    );
    return (rows[0]?.values ?? [])
      .filter((row) => {
        const ms = parseSavedAt(row[5] == null ? null : String(row[5]));
        if (ms == null || ms < sinceMs || (Number.isFinite(untilMs) && ms >= untilMs)) return false;
        // A timestamp alone is not a sufficient cursor: busy syncs can save
        // many rows in the same millisecond. The canonical id breaks that tie.
        return !(afterId && ms === sinceMs && String(row[0]) <= afterId);
      })
      .sort((a, b) => {
        const bySavedAt = (parseSavedAt(String(a[5])) ?? 0) - (parseSavedAt(String(b[5])) ?? 0);
        return bySavedAt || String(a[0]).localeCompare(String(b[0]));
      })
      .slice(0, limit)
      .map((row) => ({
      id: String(row[0]),
      canonicalUrl: row[1] == null ? null : String(row[1]),
      displayTitle: row[2] == null ? null : String(row[2]),
      searchText: String(row[3] ?? ''),
      sources: parseSources(row[4]),
      firstSavedAt: row[5] == null ? null : String(row[5]),
      lastSavedAt: row[6] == null ? null : String(row[6]),
      primaryCategory: row[7] == null ? null : String(row[7]),
      primaryDomain: row[8] == null ? null : String(row[8]),
    }));
  } finally {
    db.close();
  }
}

/**
 * Count rows the daily collector cannot place in any time window. This is an
 * all-index metric (rather than an attempted-window metric) because malformed
 * timestamps have no reliable window to which they can be attributed.
 */
export async function countCanonicalUndateableBookmarks(): Promise<number> {
  const db = await openDb(twitterBookmarksIndexPath());
  try {
    initCanonicalSchema(db);
    const rows = db.exec('SELECT first_saved_at FROM canonical_bookmarks');
    return (rows[0]?.values ?? []).filter((row) => parseSavedAt(row[0] == null ? null : String(row[0])) == null).length;
  } finally {
    db.close();
  }
}

const RELATED_STOPWORDS = new Set([
  'this', 'that', 'with', 'from', 'have', 'what', 'your', 'when', 'where', 'will',
  'about', 'into', 'over', 'more', 'like', 'just', 'them', 'they', 'then', 'than',
  'been', 'being', 'each', 'other', 'some', 'such', 'only', 'very', 'https', 'http',
  'github', 'youtube', 'video', 'using', 'used', 'their', 'there', 'here', 'also',
]);

export function relatedSeedTerms(seedText: string, maxTerms = 8): string[] {
  const terms: string[] = [];
  for (const raw of seedText.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (raw.length < 4 || RELATED_STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    if (!terms.includes(raw)) terms.push(raw);
    if (terms.length >= maxTerms) break;
  }
  return terms;
}

export interface FindRelatedOptions {
  excludeIds?: string[];
  beforeIso?: string;
  limit?: number;
}

export async function findRelatedCanonicalBookmarks(seedText: string, options: FindRelatedOptions = {}): Promise<CanonicalSearchResult[]> {
  const terms = relatedSeedTerms(seedText);
  if (terms.length === 0) return [];

  const ftsQuery = terms.map((term) => `"${term}"`).join(' OR ');
  const excludeIds = options.excludeIds ?? [];
  const limit = options.limit ?? 3;
  const beforeMs = options.beforeIso ? Date.parse(options.beforeIso) : null;
  const db = await openDb(twitterBookmarksIndexPath());

  try {
    initCanonicalSchema(db);
    const conditions = ['canonical_bookmarks_fts MATCH ?'];
    const params: (string | number)[] = [ftsQuery];
    if (excludeIds.length > 0) {
      conditions.push(`c.id NOT IN (${excludeIds.map(() => '?').join(',')})`);
      params.push(...excludeIds);
    }
    // beforeIso is applied in JS: first_saved_at mixes ISO and Twitter-format
    // strings, so SQL string comparison would silently drop X bookmarks.
    params.push(beforeMs == null ? limit : limit * 5);

    const rows = db.exec(
      `SELECT c.id, c.canonical_url, c.display_title, c.search_text, c.source_count, c.sources_json,
              bm25(canonical_bookmarks_fts) AS score, c.first_saved_at
       FROM canonical_bookmarks c
       JOIN canonical_bookmarks_fts ON canonical_bookmarks_fts.rowid = c.rowid
       WHERE ${conditions.join(' AND ')}
       ORDER BY score ASC
       LIMIT ?`,
      params,
    );
    const values = (rows[0]?.values ?? []).filter((row) => {
      if (beforeMs == null) return true;
      const ms = parseSavedAt(row[7] == null ? null : String(row[7]));
      return ms != null && ms < beforeMs;
    });
    return values.slice(0, limit).map(mapSearchRow);
  } finally {
    db.close();
  }
}

export async function listCanonicalBookmarks(options: ListCanonicalBookmarksOptions = {}): Promise<CanonicalBookmarkListResult[]> {
  const db = await openDb(twitterBookmarksIndexPath());
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;
  const query = options.query?.trim() ?? '';
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  const joinFts = Boolean(query);

  if (query) {
    conditions.push('canonical_bookmarks_fts MATCH ?');
    params.push(sanitizeFtsQuery(query));
  }
  if (options.source) {
    conditions.push(`EXISTS (
      SELECT 1 FROM bookmark_sources s
      WHERE s.canonical_id = c.id AND s.source = ?
    )`);
    params.push(options.source);
  }
  if (options.category) {
    conditions.push(`(c.primary_category = ? COLLATE NOCASE OR c.categories LIKE ?)`);
    params.push(options.category, `%${options.category}%`);
  }
  if (options.domain) {
    conditions.push(`(c.primary_domain = ? COLLATE NOCASE OR c.domains LIKE ?)`);
    params.push(options.domain, `%${options.domain}%`);
  }
  if (options.author) {
    conditions.push(`EXISTS (
      SELECT 1 FROM bookmark_sources s
      WHERE s.canonical_id = c.id AND s.author_handle = ? COLLATE NOCASE
    )`);
    params.push(options.author);
  }

  try {
    initCanonicalSchema(db);

    const select = `SELECT c.id, c.canonical_url, c.display_title, c.search_text, c.source_count,
                           c.first_saved_at, c.last_saved_at, c.sources_json,
                           c.categories, c.primary_category, c.domains, c.primary_domain,
                           (SELECT s.author_handle FROM bookmark_sources s
                            WHERE s.canonical_id = c.id AND s.author_handle IS NOT NULL AND s.author_handle != ''
                            LIMIT 1) as author_handle
                    FROM canonical_bookmarks c
                    ${joinFts ? 'JOIN canonical_bookmarks_fts ON canonical_bookmarks_fts.rowid = c.rowid' : ''}`;
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = `ORDER BY ${joinFts ? 'bm25(canonical_bookmarks_fts) ASC,' : ''} COALESCE(c.last_saved_at, c.first_saved_at, '') DESC, c.id ASC
                   LIMIT ?
                   OFFSET ?`;
    // after/before are applied in JS because first_saved_at mixes ISO and
    // Twitter-format strings — SQL string comparison would silently drop rows.
    const fetchLimit = (options.after || options.before) ? limit * 5 : limit;
    const rows = db.exec(`${select} ${where} ${order}`, [...params, fetchLimit, offset]);

    let values = rows[0]?.values ?? [];
    if (options.after || options.before) {
      const afterMs = options.after ? parseSavedAt(options.after) : null;
      const beforeMs = options.before ? parseSavedAt(options.before) : null;
      values = values.filter((row) => {
        const savedAt = row[5] == null ? null : String(row[5]); // first_saved_at
        const ms = parseSavedAt(savedAt);
        if (ms == null) return false;
        if (afterMs != null && ms <= afterMs) return false;
        if (beforeMs != null && ms >= beforeMs) return false;
        return true;
      });
    }
    return values.slice(0, limit).map(mapListRow);
  } finally {
    db.close();
  }
}

export async function countCanonicalBookmarks(options: Omit<ListCanonicalBookmarksOptions, 'limit' | 'offset'> = {}): Promise<number> {
  const db = await openDb(twitterBookmarksIndexPath());
  const query = options.query?.trim() ?? '';
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  const joinFts = Boolean(query);

  if (query) {
    conditions.push('canonical_bookmarks_fts MATCH ?');
    params.push(sanitizeFtsQuery(query));
  }
  if (options.source) {
    conditions.push(`EXISTS (
      SELECT 1 FROM bookmark_sources s
      WHERE s.canonical_id = c.id AND s.source = ?
    )`);
    params.push(options.source);
  }
  if (options.category) {
    conditions.push(`(c.primary_category = ? COLLATE NOCASE OR c.categories LIKE ?)`);
    params.push(options.category, `%${options.category}%`);
  }
  if (options.domain) {
    conditions.push(`(c.primary_domain = ? COLLATE NOCASE OR c.domains LIKE ?)`);
    params.push(options.domain, `%${options.domain}%`);
  }
  if (options.author) {
    conditions.push(`EXISTS (
      SELECT 1 FROM bookmark_sources s
      WHERE s.canonical_id = c.id AND s.author_handle = ? COLLATE NOCASE
    )`);
    params.push(options.author);
  }

  try {
    initCanonicalSchema(db);
    const rows = db.exec(
      `SELECT COUNT(*)
       FROM canonical_bookmarks c
       ${joinFts ? 'JOIN canonical_bookmarks_fts ON canonical_bookmarks_fts.rowid = c.rowid' : ''}
       ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}`,
      params,
    );
    return Number(rows[0]?.values?.[0]?.[0] ?? 0);
  } finally {
    db.close();
  }
}

export interface CanonicalSourceRow {
  id: string;
  source: string;
  profile: string | null;
  sourceItemId: string;
  sourceUrl: string;
  targetUrl: string | null;
  title: string | null;
  text: string | null;
  authorHandle: string | null;
  savedAt: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  folderPath: string[];
  links: string[];
  contentPath: string | null;
  metadata: Record<string, unknown> | null;
}

export async function getCanonicalBookmarkSources(canonicalId: string): Promise<CanonicalSourceRow[]> {
  const db = await openDb(twitterBookmarksIndexPath());
  try {
    initCanonicalSchema(db);
    const rows = db.exec(
      `SELECT id, source, profile, source_item_id, source_url, target_url,
              title, text, author_handle, saved_at, created_at, modified_at,
              folder_path_json, links_json, content_path, metadata_json
       FROM bookmark_sources
       WHERE canonical_id = ? AND active = 1`,
      [canonicalId],
    );
    return (rows[0]?.values ?? []).map((row) => ({
      id: row[0] as string,
      source: row[1] as string,
      profile: (row[2] as string) ?? null,
      sourceItemId: row[3] as string,
      sourceUrl: row[4] as string,
      targetUrl: (row[5] as string) ?? null,
      title: (row[6] as string) ?? null,
      text: (row[7] as string) ?? null,
      authorHandle: (row[8] as string) ?? null,
      savedAt: (row[9] as string) ?? null,
      createdAt: (row[10] as string) ?? null,
      modifiedAt: (row[11] as string) ?? null,
      folderPath: parseJsonStringArray(row[12]),
      links: parseJsonStringArray(row[13]),
      contentPath: (row[14] as string) ?? null,
      metadata: parseJsonObject(row[15]),
    }));
  } finally {
    db.close();
  }
}

export async function getCanonicalBookmarkById(id: string): Promise<CanonicalBookmarkListResult | null> {
  const db = await openDb(twitterBookmarksIndexPath());

  try {
    initCanonicalSchema(db);

    const rows = db.exec(
      `SELECT c.id, c.canonical_url, c.display_title, c.search_text, c.source_count,
              c.first_saved_at, c.last_saved_at, c.sources_json,
              c.categories, c.primary_category, c.domains, c.primary_domain,
              (SELECT s.author_handle FROM bookmark_sources s
               WHERE s.canonical_id = c.id AND s.author_handle IS NOT NULL AND s.author_handle != ''
               LIMIT 1) as author_handle
       FROM canonical_bookmarks c
       WHERE c.id = ?
       LIMIT 1`,
      [id],
    );
    const row = rows[0]?.values?.[0];
    return row ? mapListRow(row) : null;
  } finally {
    db.close();
  }
}

function hasListMetadata(result: CanonicalBookmarkFormatResult): result is CanonicalBookmarkListResult {
  return 'categories' in result;
}

export function formatCanonicalSearchResults(results: CanonicalBookmarkFormatResult[]): string {
  if (results.length === 0) return 'No unified bookmarks found.';

  return results
    .map((result, index) => {
      const title = result.displayTitle?.trim() || result.canonicalUrl || result.id;
      const url = result.canonicalUrl ?? '(no url)';
      const badges = result.sources.length ? result.sources.map((source) => `[${source}]`).join(' ') : `[${result.sourceCount} sources]`;
      const metadata: string[] = [];
      if (hasListMetadata(result)) {
        if (result.primaryCategory) metadata.push(result.primaryCategory);
        if (result.primaryDomain) metadata.push(result.primaryDomain);
      }
      const suffix = metadata.length ? `  ${metadata.join(' / ')}` : '';
      return `${index + 1}. ${title} ${badges}${suffix}\n   ${url}`;
    })
    .join('\n\n');
}

export async function classifyCanonicalBookmarks(): Promise<{ total: number; classified: number }> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);

  try {
    initCanonicalSchema(db);

    const canonicalRows = db.exec(
      `SELECT id, canonical_url, display_title, search_text
       FROM canonical_bookmarks
       ORDER BY id ASC`,
    )[0]?.values ?? [];
    const sourceRows = db.exec(
      `SELECT canonical_id, source_url, target_url, links_json, folder_path_json
       FROM bookmark_sources`,
    )[0]?.values ?? [];

    const sourceInputs = new Map<string, { links: string[]; folderPath: string[] }>();
    for (const row of sourceRows) {
      const canonicalId = row[0] as string;
      const existing = sourceInputs.get(canonicalId) ?? { links: [], folderPath: [] };
      for (const url of [row[1] as string | null, row[2] as string | null, ...parseJsonStringArray(row[3])]) {
        if (url) existing.links.push(url);
      }
      existing.folderPath.push(...parseJsonStringArray(row[4]));
      sourceInputs.set(canonicalId, existing);
    }

    let classified = 0;
    db.run('BEGIN TRANSACTION');
    try {
      const stmt = db.prepare(
        `UPDATE canonical_bookmarks
         SET categories = ?, primary_category = ?, domains = ?, primary_domain = ?
         WHERE id = ?`,
      );
      try {
        for (const row of canonicalRows) {
          const id = row[0] as string;
          const canonicalUrl = (row[1] as string) ?? null;
          const displayTitle = (row[2] as string) ?? undefined;
          const searchText = (row[3] as string) ?? undefined;
          const sourceInput = sourceInputs.get(id) ?? { links: [], folderPath: [] };
          const links = [...new Set([canonicalUrl, ...sourceInput.links].filter((url): url is string => typeof url === 'string' && url.length > 0))];
          const result = classifyBookmarkInput({
            id,
            title: displayTitle,
            text: searchText,
            url: canonicalUrl ?? undefined,
            links,
            folderPath: [...new Set(sourceInput.folderPath)],
          });
          const domains = [...new Set([canonicalUrl, ...result.extractedUrls].map(hostnameForUrl).filter((domain): domain is string => Boolean(domain)))];

          if (result.categories.length > 0) classified += 1;
          stmt.run([
            result.categories.length ? result.categories.join(',') : null,
            result.primary,
            domains.length ? domains.join(',') : null,
            domains[0] ?? null,
            id,
          ]);
        }
      } finally {
        stmt.free();
      }
      db.run('COMMIT');
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }

    saveDb(db, dbPath);
    return { total: canonicalRows.length, classified };
  } finally {
    db.close();
  }
}

// ── LLM classification of canonical rows ──────────────────────────────
//
// Extends the existing regex classifyCanonicalBookmarks() with an LLM path
// for rows the regex classifier left as null/'unclassified' — currently
// ~14k Raindrop + YouTube rows. Reuses the prompt builder + JSON parser
// from bookmark-classify-llm.ts (same categories vocabulary, same
// [{"id","categories","primary"}] contract), writing the result into
// canonical_bookmarks.primary_category / categories / domains / primary_domain.

export interface CanonicalLlmClassifyResult {
  engine: string;
  totalUnclassified: number;
  classified: number;
  failed: number;
  batches: number;
}

export async function classifyCanonicalBookmarksWithLlm(
  options: { engine: ResolvedEngine; onBatch?: (done: number, total: number) => void },
): Promise<CanonicalLlmClassifyResult> {
  const { engine } = options;
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);

  try {
    initCanonicalSchema(db);

    // Rows where regex classifier returned nothing. display_title is the
    // headline; search_text is the union of all source text. We feed both
    // so the model has richer signal than the X-only classify path.
    const rows = db.exec(
      `SELECT id, canonical_url, display_title, coalesce(search_text, display_title)
       FROM canonical_bookmarks
       WHERE primary_category IS NULL OR primary_category = 'unclassified'
       ORDER BY RANDOM()`,
    )[0]?.values ?? [];

    const totalUnclassified = rows.length;
    if (totalUnclassified === 0) {
      return { engine: engine.name, totalUnclassified: 0, classified: 0, failed: 0, batches: 0 };
    }

    // Pre-build per-id URL→domain map so LLM output (which may pick new
    // categories) is consistent with what we write back to canonical.
    const items: CategoryPromptItem[] = rows.map((r) => {
      const id = r[0] as string;
      const canonicalUrl = (r[1] as string | null) ?? null;
      const title = (r[2] as string | null) ?? '';
      const searchText = (r[3] as string | null) ?? '';
      // Use display_title as headline; fall back to search_text for body
      const text = title ? `${title}. ${searchText}` : searchText;
      return {
        id,
        text,
        authorHandle: null, // parity with classifyWithLlm which always supplies a handle
        links: canonicalUrl,
      };
    });

    let classified = 0;
    let failed = 0;
    let batchCount = 0;

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE);
      const batchIds = new Set(batch.map((b) => b.id));
      batchCount++;

      options.onBatch?.(i, totalUnclassified);

      try {
        const prompt = buildCategoryPrompt(batch);
        const raw = await invokeEngineAsync(engine, prompt);
        const results = parseCategoryResponse(raw, batchIds);

        db.run('BEGIN TRANSACTION');
        try {
          const stmt = db.prepare(
            `UPDATE canonical_bookmarks
             SET categories = ?, primary_category = ?, domains = ?, primary_domain = ?
             WHERE id = ?`,
          );
          try {
            for (const r of results) {
              const canonicalUrlForDomain = rows.find((row) => row[0] === r.id)?.[1] as string | null;
              const newDomains = canonicalUrlForDomain ? hostnameForUrl(canonicalUrlForDomain) : null;
              // Preserve any existing domain (regex may have set one); only add the LLM-derived new category
              const existingDomainRow = db.exec(
                `SELECT primary_domain FROM canonical_bookmarks WHERE id = ?`,
                [r.id],
              )[0]?.values[0]?.[0] as string | null;
              const finalDomains = existingDomainRow ?? newDomains;
              stmt.run([
                r.categories.length ? r.categories.join(',') : null,
                r.primary,
                finalDomains ? String(finalDomains) : null,
                finalDomains ? String(finalDomains) : null,
                r.id,
              ]);
            }
          } finally {
            stmt.free();
          }
          db.run('COMMIT');
        } catch (err) {
          db.run('ROLLBACK');
          throw err;
        }

        classified += results.length;
        failed += batch.length - results.length;

        // Persist after every batch — a crash + restart picks up where we left off.
        saveDb(db, dbPath);
      } catch (err) {
        failed += batch.length;
        process.stderr.write(
          `  Canonical classify batch ${batchCount} failed: ${(err as Error).message}\n`,
        );
      }
    }

    return { engine: engine.name, totalUnclassified, classified, failed, batches: batchCount };
  } finally {
    db.close();
  }
}
