/**
 * SQLite FTS5 index for the X/Twitter following roster.
 *
 * Mirrors the bookmarks-db.ts pattern: a content table + FTS5 virtual table,
 * with BM25 search over handle, name, bio, domains, expertise, and summary.
 * Bookmark overlap is computed by querying the existing bookmarks.db for
 * author_handle counts.
 */

import type { Database } from 'sql.js';
import { openDb, saveDb } from '../db.js';
import { readJsonLines } from '../fs.js';
import { followingCachePath, followingIndexPath, followingMetaPath } from './paths.js';
import { twitterBookmarksIndexPath } from '../paths.js';
import type { FollowingRecord } from './types.js';
import { sanitizeFtsQuery } from '../bookmarks-db.js';

const SCHEMA_VERSION = 1;

export interface FollowingSearchResult {
  userId: string;
  handle: string;
  name: string;
  bio: string | null;
  domains: string[];
  primaryDomain: string | null;
  expertise: string[];
  expertiseSummary: string | null;
  bookmarkOverlap: number;
  followerCount: number | null;
  verified: boolean;
  score: number;
}

export interface FollowingListResult {
  userId: string;
  handle: string;
  name: string;
  bio: string | null;
  domains: string[];
  primaryDomain: string | null;
  expertise: string[];
  expertiseSummary: string | null;
  bookmarkOverlap: number;
  followerCount: number | null;
  verified: boolean;
}

export interface FollowingShowResult extends FollowingListResult {
  followingCount: number | null;
  profileImageUrl: string | null;
  syncedAt: string;
  topBookmarks: Array<{ id: string; text: string; url: string; postedAt: string | null }>;
}

export interface FollowingStats {
  totalFollowing: number;
  classifiedCount: number;
  topDomains: Array<{ domain: string; count: number }>;
  mostBookmarked: Array<{ handle: string; name: string; bookmarkOverlap: number }>;
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((e): e is string => typeof e === 'string') : [];
  } catch {
    return [];
  }
}

function parseCsv(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Shared SELECT column list for search/list projections (aliased table `f`). */
const FOLLOWING_SELECT_COLUMNS =
  'f.user_id, f.handle, f.name, f.bio, f.domains, f.primary_domain, ' +
  'f.expertise, f.expertise_summary, f.bookmark_overlap, f.follower_count, f.verified';

/** Map a row selected with FOLLOWING_SELECT_COLUMNS into a FollowingListResult. */
function rowToFollowingBase(row: any[]): FollowingListResult {
  return {
    userId: String(row[0]),
    handle: String(row[1]),
    name: String(row[2]),
    bio: (row[3] as string) ?? null,
    domains: parseJsonArray(row[4]),
    primaryDomain: (row[5] as string) ?? null,
    expertise: parseJsonArray(row[6]),
    expertiseSummary: (row[7] as string) ?? null,
    bookmarkOverlap: Number(row[8] ?? 0),
    followerCount: (row[9] as number) ?? null,
    verified: Boolean(row[10]),
  };
}

function initSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);

  db.run(`CREATE TABLE IF NOT EXISTS following (
    user_id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    name TEXT NOT NULL,
    bio TEXT,
    profile_image_url TEXT,
    follower_count INTEGER,
    following_count INTEGER,
    verified INTEGER DEFAULT 0,
    synced_at TEXT NOT NULL,
    domains TEXT,
    primary_domain TEXT,
    expertise TEXT,
    expertise_summary TEXT,
    bookmark_overlap INTEGER DEFAULT 0
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_following_handle ON following(handle)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_following_domain ON following(primary_domain)`);

  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS following_fts USING fts5(
    handle,
    name,
    bio,
    domains,
    expertise,
    expertise_summary,
    content=following,
    content_rowid=rowid,
    tokenize='porter unicode61'
  )`);

  db.run("REPLACE INTO meta VALUES ('schema_version', ?)", [String(SCHEMA_VERSION)]);
}

function serializeJsonArray(values: string[] | undefined | null): string | null {
  if (!values || values.length === 0) return null;
  return JSON.stringify(values);
}

function serializeCsv(values: string[] | undefined | null): string | null {
  if (!values || values.length === 0) return null;
  return values.join(',');
}

function insertRecord(db: Database, r: FollowingRecord, bookmarkOverlap?: number): void {
  db.run(
    `INSERT OR REPLACE INTO following VALUES (${Array(14).fill('?').join(',')})`,
    [
      r.userId,
      r.handle,
      r.name,
      r.bio ?? null,
      r.profileImageUrl ?? null,
      r.followerCount ?? null,
      r.followingCount ?? null,
      r.verified ? 1 : 0,
      r.syncedAt,
      serializeJsonArray(r.domains),
      r.primaryDomain ?? null,
      serializeJsonArray(r.expertise),
      r.expertiseSummary ?? null,
      bookmarkOverlap ?? r.bookmarkOverlap ?? 0,
    ]
  );
}

/**
 * Count bookmarks from a given author handle in the existing bookmarks.db.
 * Used to compute bookmark overlap for following records.
 */
function getBookmarkOverlap(handle: string, bookmarksDb?: Database): number {
  if (!bookmarksDb) return 0;
  try {
    const rows = bookmarksDb.exec(
      `SELECT COUNT(*) FROM bookmarks WHERE author_handle = ? COLLATE NOCASE`,
      [handle]
    );
    return Number(rows[0]?.values?.[0]?.[0] ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Fetch top bookmarked posts from a given author handle.
 */
function getTopBookmarksByAuthor(
  handle: string,
  limit: number,
  bookmarksDb?: Database,
): Array<{ id: string; text: string; url: string; postedAt: string | null }> {
  if (!bookmarksDb) return [];
  try {
    const rows = bookmarksDb.exec(
      `SELECT id, text, url, posted_at FROM bookmarks
       WHERE author_handle = ? COLLATE NOCASE
       ORDER BY COALESCE(posted_at, bookmarked_at) DESC
       LIMIT ?`,
      [handle, limit]
    );
    if (!rows.length) return [];
    return rows[0].values.map((r) => ({
      id: String(r[0]),
      text: String(r[1] ?? ''),
      url: String(r[2] ?? ''),
      postedAt: (r[3] as string) ?? null,
    }));
  } catch {
    return [];
  }
}

export interface BuildIndexOptions {
  force?: boolean;
  /** Optional bookmarks DB handle for overlap computation. */
  bookmarksDb?: Database;
}

export async function buildFollowingIndex(
  options: BuildIndexOptions = {},
): Promise<{ dbPath: string; recordCount: number; newRecords: number }> {
  const cachePath = followingCachePath();
  const dbPath = followingIndexPath();
  const records = await readJsonLines<FollowingRecord>(cachePath);

  const db = await openDb(dbPath);
  try {
    if (options.force) {
      db.run('DROP TABLE IF EXISTS following_fts');
      db.run('DROP TABLE IF EXISTS following');
      db.run('DROP TABLE IF EXISTS meta');
    }

    initSchema(db);

    // Preserve classification fields when refreshing existing rows
    const existingRows = new Map<string, { domains: string | null; primaryDomain: string | null; expertise: string | null; expertiseSummary: string | null; bookmarkOverlap: number }>();
    try {
      const rows = db.exec(
        `SELECT user_id, domains, primary_domain, expertise, expertise_summary, bookmark_overlap FROM following`
      );
      for (const r of (rows[0]?.values ?? [])) {
        existingRows.set(r[0] as string, {
          domains: (r[1] as string) ?? null,
          primaryDomain: (r[2] as string) ?? null,
          expertise: (r[3] as string) ?? null,
          expertiseSummary: (r[4] as string) ?? null,
          bookmarkOverlap: Number(r[5] ?? 0),
        });
      }
    } catch { /* table may be empty */ }

    const newRecords = records.filter((r) => !existingRows.has(r.userId));

    // Open bookmarks DB for overlap computation if not provided
    let bookmarksDb = options.bookmarksDb;
    let shouldCloseBookmarksDb = false;
    if (!bookmarksDb) {
      try {
        const { openBookmarksDb } = await import('../bookmarks-db.js');
        bookmarksDb = await openBookmarksDb();
        shouldCloseBookmarksDb = true;
      } catch { /* bookmarks DB may not exist */ }
    }

    if (records.length > 0) {
      db.run('BEGIN TRANSACTION');
      try {
        for (const record of records) {
          const preserved = existingRows.get(record.userId);
          // Compute bookmark overlap: preserve existing value from JSONL/DB,
          // only compute from bookmarks DB when no overlap is known yet
          let overlap = preserved?.bookmarkOverlap ?? record.bookmarkOverlap ?? 0;
          if (bookmarksDb && !preserved && !record.bookmarkOverlap) {
            overlap = getBookmarkOverlap(record.handle, bookmarksDb);
          }

          // Merge classification fields: prefer record's if set, else preserved
          const merged: FollowingRecord = {
            ...record,
            domains: record.domains ?? parseJsonArray(preserved?.domains),
            primaryDomain: record.primaryDomain ?? preserved?.primaryDomain ?? undefined,
            expertise: record.expertise ?? parseJsonArray(preserved?.expertise),
            expertiseSummary: record.expertiseSummary ?? preserved?.expertiseSummary ?? undefined,
            bookmarkOverlap: overlap,
          };

          insertRecord(db, merged, overlap);
        }
        db.run('COMMIT');
      } catch (err) {
        db.run('ROLLBACK');
        throw err;
      }
    }

    if (shouldCloseBookmarksDb) bookmarksDb?.close();

    db.run(`INSERT INTO following_fts(following_fts) VALUES('rebuild')`);
    saveDb(db, dbPath);

    const totalRows = db.exec('SELECT COUNT(*) FROM following')[0]?.values[0]?.[0] as number;
    return { dbPath, recordCount: totalRows, newRecords: newRecords.length };
  } finally {
    db.close();
  }
}

export interface SearchFollowingOptions {
  query: string;
  limit?: number;
}

export async function searchFollowing(options: SearchFollowingOptions): Promise<FollowingSearchResult[]> {
  const db = await openFollowingDb();
  const limit = options.limit ?? 20;

  try {
    const sql = `
      SELECT ${FOLLOWING_SELECT_COLUMNS}, bm25(following_fts) as score
      FROM following f
      JOIN following_fts ON following_fts.rowid = f.rowid
      WHERE following_fts MATCH ?
      ORDER BY bm25(following_fts) ASC
      LIMIT ?
    `;

    let rows;
    try {
      rows = db.exec(sql, [sanitizeFtsQuery(options.query), limit]);
    } catch (err) {
      const msg = (err as Error).message ?? '';
      if (msg.includes('fts5') || msg.includes('MATCH') || msg.includes('syntax')) {
        throw new Error(`Invalid search query: "${options.query}". Try simpler terms.`);
      }
      throw err;
    }

    if (!rows.length) return [];
    return rows[0].values.map((row) => ({ ...rowToFollowingBase(row), score: row[11] as number }));
  } finally {
    db.close();
  }
}

export interface ListFollowingOptions {
  domain?: string;
  limit?: number;
  sort?: 'relevance' | 'overlap' | 'followers';
}

export async function listFollowing(options: ListFollowingOptions = {}): Promise<FollowingListResult[]> {
  const db = await openFollowingDb();
  const limit = options.limit ?? 30;

  try {
    let where = '';
    const params: Array<string | number> = [];

    if (options.domain) {
      where = `WHERE f.domains LIKE ? OR f.primary_domain = ?`;
      params.push(`%${options.domain}%`, options.domain);
    }

    const sortClause = options.sort === 'overlap'
      ? `ORDER BY f.bookmark_overlap DESC, f.handle ASC`
      : options.sort === 'followers'
        ? `ORDER BY f.follower_count DESC NULLS LAST, f.handle ASC`
        : `ORDER BY f.handle ASC`;

    const sql = `
      SELECT ${FOLLOWING_SELECT_COLUMNS}
      FROM following f
      ${where}
      ${sortClause}
      LIMIT ?
    `;
    params.push(limit);

    const rows = db.exec(sql, params);
    if (!rows.length) return [];
    return rows[0].values.map(rowToFollowingBase);
  } finally {
    db.close();
  }
}

export async function showFollowing(handle: string): Promise<FollowingShowResult | null> {
  const db = await openFollowingDb();

  // Strip leading @ if present
  const cleanHandle = handle.replace(/^@/, '');

  try {
    const rows = db.exec(
      `SELECT
        f.user_id, f.handle, f.name, f.bio, f.profile_image_url,
        f.follower_count, f.following_count, f.verified, f.synced_at,
        f.domains, f.primary_domain, f.expertise, f.expertise_summary,
        f.bookmark_overlap
       FROM following f
       WHERE f.handle = ? COLLATE NOCASE
       LIMIT 1`,
      [cleanHandle]
    );

    const row = rows[0]?.values?.[0];
    if (!row) return null;

    // Fetch top bookmarks from the bookmarks DB
    let topBookmarks: Array<{ id: string; text: string; url: string; postedAt: string | null }> = [];
    try {
      const { openBookmarksDb } = await import('../bookmarks-db.js');
      const bookmarksDb = await openBookmarksDb();
      topBookmarks = getTopBookmarksByAuthor(cleanHandle, 5, bookmarksDb);
      bookmarksDb.close();
    } catch { /* bookmarks DB may not exist */ }

    return {
      userId: String(row[0]),
      handle: String(row[1]),
      name: String(row[2]),
      bio: (row[3] as string) ?? null,
      profileImageUrl: (row[4] as string) ?? null,
      followerCount: (row[5] as number) ?? null,
      followingCount: (row[6] as number) ?? null,
      verified: Boolean(row[7]),
      syncedAt: String(row[8]),
      domains: parseJsonArray(row[9]),
      primaryDomain: (row[10] as string) ?? null,
      expertise: parseJsonArray(row[11]),
      expertiseSummary: (row[12] as string) ?? null,
      bookmarkOverlap: Number(row[13] ?? 0),
      topBookmarks,
    };
  } finally {
    db.close();
  }
}

export async function getFollowingStats(): Promise<FollowingStats> {
  const db = await openFollowingDb();

  try {
    const total = Number(db.exec('SELECT COUNT(*) FROM following')[0]?.values?.[0]?.[0] ?? 0);
    const classified = Number(
      db.exec(`SELECT COUNT(*) FROM following WHERE primary_domain IS NOT NULL AND primary_domain != ''`)[0]?.values?.[0]?.[0] ?? 0
    );

    const domainRows = db.exec(
      `SELECT primary_domain, COUNT(*) as c FROM following
       WHERE primary_domain IS NOT NULL AND primary_domain != ''
       GROUP BY primary_domain ORDER BY c DESC LIMIT 15`
    );
    const topDomains = (domainRows[0]?.values ?? []).map((r) => ({
      domain: String(r[0]),
      count: Number(r[1]),
    }));

    const overlapRows = db.exec(
      `SELECT handle, name, bookmark_overlap FROM following
       WHERE bookmark_overlap > 0
       ORDER BY bookmark_overlap DESC LIMIT 10`
    );
    const mostBookmarked = (overlapRows[0]?.values ?? []).map((r) => ({
      handle: String(r[0]),
      name: String(r[1]),
      bookmarkOverlap: Number(r[2]),
    }));

    return { totalFollowing: total, classifiedCount: classified, topDomains, mostBookmarked };
  } finally {
    db.close();
  }
}

export interface FollowingStatusView {
  count: number;
  classifiedCount: number;
  lastUpdated: string | null;
  cachePath: string;
}

export async function getFollowingStatus(): Promise<FollowingStatusView> {
  const cachePath = followingCachePath();
  const metaPath = followingMetaPath();
  let lastUpdated: string | null = null;
  let count = 0;

  try {
    const { readJson } = await import('../fs.js');
    const meta = await readJson<{ lastUpdated?: string; count?: number }>(metaPath);
    lastUpdated = meta.lastUpdated ?? null;
    count = meta.count ?? 0;
  } catch { /* no meta file yet */ }

  let classifiedCount = 0;
  try {
    const stats = await getFollowingStats();
    classifiedCount = stats.classifiedCount;
    if (count === 0) count = stats.totalFollowing;
  } catch { /* DB may not exist yet */ }

  return { count, classifiedCount, lastUpdated, cachePath };
}

// ── Classification update helpers ────────────────────────────────────────

export async function updateFollowingClassification(
  updates: Array<{
    userId: string;
    domains?: string[];
    primaryDomain?: string;
    expertise?: string[];
    expertiseSummary?: string;
  }>,
): Promise<void> {
  if (!updates.length) return;
  const db = await openFollowingDb();

  try {
    const stmt = db.prepare(
      `UPDATE following SET domains = ?, primary_domain = ?, expertise = ?, expertise_summary = ? WHERE user_id = ?`
    );
    for (const u of updates) {
      stmt.run([
        serializeJsonArray(u.domains) ?? null,
        u.primaryDomain ?? null,
        serializeJsonArray(u.expertise) ?? null,
        u.expertiseSummary ?? null,
        u.userId,
      ]);
    }
    stmt.free();
    db.run(`INSERT INTO following_fts(following_fts) VALUES('rebuild')`);
    saveDb(db, followingIndexPath());
  } finally {
    db.close();
  }
}

export interface ClassificationCandidate {
  userId: string;
  handle: string;
  name: string;
  bio: string;
  bookmarkOverlap: number;
}

/** Shared query for accounts that still need classification (fixed WHERE — no user input). */
async function selectClassificationCandidates(where: string): Promise<ClassificationCandidate[]> {
  const db = await openFollowingDb();
  try {
    const rows = db.exec(
      `SELECT user_id, handle, name, bio, bookmark_overlap FROM following
       WHERE ${where}
       ORDER BY bookmark_overlap DESC`
    );
    if (!rows.length) return [];
    return rows[0].values.map((r) => ({
      userId: String(r[0]),
      handle: String(r[1]),
      name: String(r[2]),
      bio: (r[3] as string) ?? '',
      bookmarkOverlap: Number(r[4] ?? 0),
    }));
  } finally {
    db.close();
  }
}

/** Accounts with no classification at all. Used by the cheap regex pass. */
export function getUnclassifiedFollowing(): Promise<ClassificationCandidate[]> {
  return selectClassificationCandidates(`primary_domain IS NULL OR primary_domain = ''`);
}

/**
 * Accounts the LLM pass should (re)classify: never-classified rows PLUS rows
 * stuck on the low-signal `general` fallback (e.g. left by a prior regex pass).
 * Without this, `sync-following --regex` then `classify-following` is a no-op.
 */
export function getReclassifiableFollowing(): Promise<ClassificationCandidate[]> {
  return selectClassificationCandidates(
    `primary_domain IS NULL OR primary_domain = '' OR primary_domain = 'general'`
  );
}

/** Open the following DB with schema initialized. Caller closes the handle. */
export async function openFollowingDb(): Promise<Database> {
  const db = await openDb(followingIndexPath());
  initSchema(db);
  return db;
}
