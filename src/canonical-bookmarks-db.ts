import crypto from 'node:crypto';
import path from 'node:path';
import type { Database } from 'sql.js';
import { openDb, saveDb } from './db.js';
import { pathExists, readJsonLines } from './fs.js';
import { dataDir, twitterBookmarksCachePath, twitterBookmarksIndexPath } from './paths.js';
import type { BookmarkRecord } from './types.js';
import { dedupeKeyForUrl, dedupeKeyForXBookmark } from './url-normalize.js';
import { sanitizeFtsQuery } from './bookmarks-db.js';
import { classifyBookmarkInput } from './bookmark-classify.js';
import { raindropBookmarksCachePath } from './raindrop/paths.js';
import type { RaindropRecord } from './raindrop/types.js';

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
}

export interface ListCanonicalBookmarksOptions {
  source?: string;
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
  topics: string[];
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
    active INTEGER NOT NULL DEFAULT 1,
    canonical_id TEXT
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmark_sources_dedupe_key ON bookmark_sources(dedupe_key)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmark_sources_canonical_id ON bookmark_sources(canonical_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmark_sources_source ON bookmark_sources(source, profile)`);

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

function canonicalColumnExists(db: Database, column: string): boolean {
  const rows = db.exec(`PRAGMA table_info(canonical_bookmarks)`);
  const columns = rows[0]?.values ?? [];
  return columns.some((row) => row[1] === column);
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

function parseSources(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
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
  };
}

function youtubeSourceFromVideo(video: YoutubeSourceVideoInput, savedAt: string): CanonicalSourceInput {
  const sourceUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
  return {
    id: `youtube:${video.videoId}`,
    source: 'youtube',
    profile: null,
    sourceItemId: video.videoId,
    sourceUrl,
    targetUrl: null,
    dedupeKey: dedupeKeyForUrl(sourceUrl),
    title: video.title,
    text: compactText([video.tldr, video.keyPoints, video.topics]),
    authorHandle: null,
    savedAt,
    createdAt: video.published ?? null,
    modifiedAt: null,
    folderPath: [],
    links: [],
  };
}

function readYoutubeSourcesFromDb(db: Database): CanonicalSourceInput[] {
  const rows = db.exec(
    `SELECT id, source, profile, source_item_id, source_url, target_url, dedupe_key,
            title, text, author_handle, saved_at, created_at, modified_at,
            folder_path_json, links_json
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
  folder_path_json, links_json, active, canonical_id
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`;

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
  };
}

export async function rebuildCanonicalIndex(_options: RebuildCanonicalOptions = {}): Promise<CanonicalRebuildResult> {
  const dbPath = twitterBookmarksIndexPath();
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

    sourceRows.push(...readYoutubeSourcesFromDb(db));

    const groups = new Map<string, CanonicalSourceInput[]>();
    for (const source of sourceRows) {
      const existing = groups.get(source.dedupeKey) ?? [];
      existing.push(source);
      groups.set(source.dedupeKey, existing);
    }
    const canonicalGroups = [...groups.entries()].map(([dedupeKey, sources]) => buildCanonicalGroup(dedupeKey, sources));

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

export async function listCanonicalBookmarks(options: ListCanonicalBookmarksOptions = {}): Promise<CanonicalBookmarkListResult[]> {
  const db = await openDb(twitterBookmarksIndexPath());
  const limit = options.limit ?? 20;
  const offset = options.offset ?? 0;

  try {
    initCanonicalSchema(db);

    const select = `SELECT c.id, c.canonical_url, c.display_title, c.search_text, c.source_count,
                           c.first_saved_at, c.last_saved_at, c.sources_json,
                           c.categories, c.primary_category, c.domains, c.primary_domain
                    FROM canonical_bookmarks c`;
    const order = `ORDER BY COALESCE(c.last_saved_at, c.first_saved_at, '') DESC, c.id ASC
                   LIMIT ?
                   OFFSET ?`;
    const rows = options.source
      ? db.exec(
        `${select}
         WHERE EXISTS (
           SELECT 1 FROM bookmark_sources s
           WHERE s.canonical_id = c.id AND s.source = ?
         )
         ${order}`,
        [options.source, limit, offset],
      )
      : db.exec(`${select} ${order}`, [limit, offset]);

    return (rows[0]?.values ?? []).map(mapListRow);
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
}

export async function getCanonicalBookmarkSources(canonicalId: string): Promise<CanonicalSourceRow[]> {
  const db = await openDb(twitterBookmarksIndexPath());
  try {
    initCanonicalSchema(db);
    const rows = db.exec(
      `SELECT id, source, profile, source_item_id, source_url, target_url,
              title, text, author_handle, saved_at, created_at, modified_at,
              folder_path_json, links_json
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
              c.categories, c.primary_category, c.domains, c.primary_domain
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
