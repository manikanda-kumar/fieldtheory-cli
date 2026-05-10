import crypto from 'node:crypto';
import type { Database } from 'sql.js';
import { openDb, saveDb } from './db.js';
import { readJsonLines } from './fs.js';
import { browserBookmarksCachePath, twitterBookmarksCachePath, twitterBookmarksIndexPath } from './paths.js';
import type { BrowserBookmarkProvider, BrowserBookmarkRecord } from './browser-bookmarks.js';
import type { BookmarkRecord } from './types.js';
import { dedupeKeyForUrl, dedupeKeyForXBookmark } from './url-normalize.js';
import { sanitizeFtsQuery } from './bookmarks-db.js';
import { classifyBookmarkInput } from './bookmark-classify.js';

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
  sources: string[];
  categories: string | null;
  primaryCategory: string | null;
  domains: string | null;
  primaryDomain: string | null;
}

export interface ListCanonicalBookmarksOptions {
  source?: string;
  limit?: number;
}

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
  browserSources: Array<{ browser: BrowserBookmarkProvider; profile: string }>;
}

export interface SearchCanonicalOptions {
  query: string;
  limit?: number;
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

function browserSourceFromRecord(record: BrowserBookmarkRecord): CanonicalSourceInput {
  return {
    id: `browser:${record.id}`,
    source: record.browser,
    profile: record.profile,
    sourceItemId: record.sourceItemId,
    sourceUrl: record.url,
    targetUrl: record.url,
    dedupeKey: dedupeKeyForUrl(record.url),
    title: record.title || record.url,
    text: null,
    authorHandle: null,
    savedAt: record.dateAdded ?? record.syncedAt ?? null,
    createdAt: record.dateAdded ?? null,
    modifiedAt: record.dateModified ?? null,
    folderPath: record.folderPath ?? [],
    links: [],
  };
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

function insertSource(db: Database, source: CanonicalSourceInput, canonicalId: string): void {
  db.run(
    `INSERT INTO bookmark_sources (
      id, source, profile, source_item_id, source_url, target_url, dedupe_key,
      title, text, author_handle, saved_at, created_at, modified_at,
      folder_path_json, links_json, active, canonical_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
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
    ],
  );
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
  } catch {
    // Existing DB may not have canonical tables yet.
  }
  return preserved;
}

function insertCanonical(db: Database, group: CanonicalGroup, preserved?: PreservedCanonicalFields): void {
  db.run(
    `INSERT INTO canonical_bookmarks (
      id, dedupe_key, canonical_url, display_title, search_text,
      categories, primary_category, domains, primary_domain,
      source_count, first_saved_at, last_saved_at, sources_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
    ],
  );
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
    sources: parseSources(row[5]),
    categories: (row[6] as string) ?? null,
    primaryCategory: (row[7] as string) ?? null,
    domains: (row[8] as string) ?? null,
    primaryDomain: (row[9] as string) ?? null,
  };
}

export async function rebuildCanonicalIndex(options: RebuildCanonicalOptions): Promise<CanonicalRebuildResult> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);

  try {
    initCanonicalSchema(db);
    const preservedFields = readPreservedCanonicalFields(db);

    const sourceRows: CanonicalSourceInput[] = [];
    const xRecords = await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath());
    sourceRows.push(...xRecords.map(xSourceFromRecord));

    for (const source of options.browserSources) {
      const records = await readJsonLines<BrowserBookmarkRecord>(browserBookmarksCachePath(source.browser, source.profile));
      sourceRows.push(...records.map(browserSourceFromRecord));
    }

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
      for (const group of canonicalGroups) {
        insertCanonical(db, group, preservedFields.get(group.dedupeKey));
        const groupSources = groups.get(group.dedupeKey) ?? [];
        for (const source of groupSources) insertSource(db, source, group.id);
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

  try {
    initCanonicalSchema(db);

    const select = `SELECT c.id, c.canonical_url, c.display_title, c.search_text, c.source_count, c.sources_json,
                           c.categories, c.primary_category, c.domains, c.primary_domain
                    FROM canonical_bookmarks c`;
    const order = `ORDER BY COALESCE(c.last_saved_at, c.first_saved_at, '') DESC, c.id ASC
                   LIMIT ?`;
    const rows = options.source
      ? db.exec(
        `${select}
         WHERE EXISTS (
           SELECT 1 FROM bookmark_sources s
           WHERE s.canonical_id = c.id AND s.source = ?
         )
         ${order}`,
        [options.source, limit],
      )
      : db.exec(`${select} ${order}`, [limit]);

    return (rows[0]?.values ?? []).map(mapListRow);
  } finally {
    db.close();
  }
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
