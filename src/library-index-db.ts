/**
 * Full-text index over Library markdown: YouTube note bodies, daily digests,
 * wiki pages (categories/domains/entities/sources), project notes, concepts,
 * briefs, scratchpad, and portable commands.
 *
 * Its own SQLite archive rather than rows in canonical_bookmarks: notes have no
 * URL and no dedupe key, so they cannot join the canonical dedupe graph. Search
 * surfaces query both and present the results side by side.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'sql.js';
import { acquireDbLock, openDb, releaseDbLock, saveDb } from './db.js';
import { canonicalCommandsDir, canonicalLibraryDir, codexContextSessionsDir, libraryIndexPath } from './paths.js';
import { sanitizeFtsQuery } from './bookmarks-db.js';
import { collectDocumentTags } from './md-tags.js';

export type LibraryDocPlace = 'library' | 'commands';

export interface LibraryDocRow {
  id: string;
  place: LibraryDocPlace;
  relPath: string;
  path: string;
  section: string;
  title: string;
  tags: string[];
  updatedAt: string;
  size: number;
}

export interface LibraryDocSearchResult extends LibraryDocRow {
  snippet: string;
  score: number;
}

export interface LibraryIndexResult {
  dbPath: string;
  added: number;
  updated: number;
  removed: number;
  total: number;
}

export interface LibraryDocSearchOptions {
  query?: string;
  section?: string;
  place?: LibraryDocPlace;
  limit?: number;
  offset?: number;
}

export interface LibraryIndexStats {
  total: number;
  sections: Array<{ section: string; count: number }>;
  lastUpdatedAt: string | null;
  indexed: boolean;
}

/**
 * `library/bookmarks/` is one markdown file per bookmark written by `ft md`.
 * Those rows already live in canonical_bookmarks with better metadata, so
 * indexing them here would double every hit in a merged search.
 */
const EXCLUDED_REL_PREFIXES = ['bookmarks/'];

/** Guards against a stray transcript dump bloating the index. */
const MAX_BODY_CHARS = 100_000;

interface ScannedFile {
  place: LibraryDocPlace;
  absPath: string;
  relPath: string;
  mtimeMs: number;
  size: number;
}

function initLibrarySchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS library_docs (
    id TEXT PRIMARY KEY,
    place TEXT NOT NULL,
    rel_path TEXT NOT NULL,
    abs_path TEXT NOT NULL,
    section TEXT NOT NULL,
    title TEXT NOT NULL,
    tags TEXT NOT NULL,
    body TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime_ms INTEGER NOT NULL
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_library_docs_section ON library_docs(section)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_library_docs_place ON library_docs(place)`);

  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS library_docs_fts USING fts5(
    title,
    tags,
    body,
    content=library_docs,
    content_rowid=rowid,
    tokenize='porter unicode61'
  )`);
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function sectionForRelPath(relPath: string): string {
  const [head, ...rest] = relPath.split('/');
  return rest.length === 0 ? '(root)' : head;
}

function titleFromContent(relPath: string, content: string): string {
  const heading = content.split('\n').find((line) => /^#\s+/.test(line));
  if (heading) return heading.replace(/^#\s+/, '').trim();
  return path.basename(relPath, path.extname(relPath));
}

function isExcludedRelPath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  return EXCLUDED_REL_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

function scanDir(root: string, place: LibraryDocPlace, skipDirs: string[]): ScannedFile[] {
  const files: ScannedFile[] = [];
  if (!fs.existsSync(root)) return files;
  const resolvedRoot = path.resolve(root);
  const skip = new Set(skipDirs.map((dir) => path.resolve(dir)));

  function walk(current: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(path.resolve(absPath))) continue;
        walk(absPath);
        continue;
      }
      if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue;
      const relPath = toPosix(path.relative(resolvedRoot, absPath));
      if (place === 'library' && isExcludedRelPath(relPath)) continue;
      try {
        const stats = fs.statSync(absPath);
        files.push({ place, absPath, relPath, mtimeMs: Math.round(stats.mtimeMs), size: stats.size });
      } catch {
        // File vanished between readdir and stat — skip it.
      }
    }
  }

  walk(resolvedRoot);
  return files;
}

function scanLibraryFiles(): ScannedFile[] {
  const libraryRoot = path.resolve(canonicalLibraryDir());
  const commandsRoot = path.resolve(canonicalCommandsDir());
  const commandsInsideLibrary = commandsRoot !== libraryRoot && commandsRoot.startsWith(`${libraryRoot}${path.sep}`);

  const librarySkips = [codexContextSessionsDir()];
  if (commandsInsideLibrary) librarySkips.push(commandsRoot);

  return [
    ...scanDir(libraryRoot, 'library', librarySkips),
    ...scanDir(commandsRoot, 'commands', []),
  ];
}

function docId(file: ScannedFile): string {
  return `${file.place}:${file.relPath}`;
}

function readIndexedState(db: Database): Map<string, { mtimeMs: number; size: number }> {
  const state = new Map<string, { mtimeMs: number; size: number }>();
  const rows = db.exec(`SELECT id, mtime_ms, size FROM library_docs`);
  for (const row of rows[0]?.values ?? []) {
    state.set(String(row[0]), { mtimeMs: Number(row[1]), size: Number(row[2]) });
  }
  return state;
}

function upsertDoc(db: Database, file: ScannedFile): boolean {
  let content: string;
  try {
    content = fs.readFileSync(file.absPath, 'utf-8');
  } catch {
    return false;
  }

  db.run(
    `INSERT INTO library_docs (id, place, rel_path, abs_path, section, title, tags, body, updated_at, size, mtime_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       place = excluded.place,
       rel_path = excluded.rel_path,
       abs_path = excluded.abs_path,
       section = excluded.section,
       title = excluded.title,
       tags = excluded.tags,
       body = excluded.body,
       updated_at = excluded.updated_at,
       size = excluded.size,
       mtime_ms = excluded.mtime_ms`,
    [
      docId(file),
      file.place,
      file.relPath,
      file.absPath,
      sectionForRelPath(file.relPath),
      titleFromContent(file.relPath, content),
      collectDocumentTags(content).join(' '),
      content.slice(0, MAX_BODY_CHARS),
      new Date(file.mtimeMs).toISOString(),
      file.size,
      file.mtimeMs,
    ],
  );
  return true;
}

/**
 * Bring the index in line with the filesystem. Only files whose mtime or size
 * changed are re-read; the FTS table is rebuilt from the content table (an
 * in-memory pass) when anything changed, which is simpler and safer than
 * hand-maintaining external-content delete/insert pairs.
 */
export async function reindexLibraryDocs(options: { force?: boolean } = {}): Promise<LibraryIndexResult> {
  const dbPath = libraryIndexPath();
  const lock = await acquireDbLock(dbPath);
  try {
    const db = await openDb(dbPath);
    try {
      initLibrarySchema(db);
      if (options.force) {
        db.run(`DELETE FROM library_docs`);
      }

      const files = scanLibraryFiles();
      const indexed = options.force ? new Map<string, { mtimeMs: number; size: number }>() : readIndexedState(db);
      const seen = new Set<string>();

      let added = 0;
      let updated = 0;

      db.run('BEGIN');
      try {
        for (const file of files) {
          const id = docId(file);
          seen.add(id);
          const previous = indexed.get(id);
          if (previous && previous.mtimeMs === file.mtimeMs && previous.size === file.size) continue;
          if (!upsertDoc(db, file)) continue;
          if (previous) updated += 1;
          else added += 1;
        }

        let removed = 0;
        for (const id of indexed.keys()) {
          if (seen.has(id)) continue;
          db.run(`DELETE FROM library_docs WHERE id = ?`, [id]);
          removed += 1;
        }
        db.run('COMMIT');

        if (added + updated + removed > 0 || options.force) {
          db.run(`INSERT INTO library_docs_fts(library_docs_fts) VALUES('rebuild')`);
        }

        const total = Number(db.exec(`SELECT COUNT(*) FROM library_docs`)[0]?.values[0][0] ?? 0);
        if (added + updated + removed > 0 || options.force) saveDb(db, dbPath);
        return { dbPath, added, updated, removed, total };
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    } finally {
      db.close();
    }
  } finally {
    releaseDbLock(lock);
  }
}

let freshUntil = 0;
const FRESHNESS_TTL_MS = 5_000;

/**
 * Cheap refresh for read paths: a stat sweep over ~1.4k files, throttled so a
 * burst of web requests does not re-walk the tree for each one.
 */
export async function ensureLibraryIndexFresh(): Promise<void> {
  if (Date.now() < freshUntil) return;
  freshUntil = Date.now() + FRESHNESS_TTL_MS;
  try {
    await reindexLibraryDocs();
  } catch {
    // A locked or unreadable index must not break search — callers fall back.
  }
}

export function resetLibraryIndexFreshnessForTest(): void {
  freshUntil = 0;
}

function mapDocRow(row: unknown[]): LibraryDocRow {
  const tags = String(row[6] ?? '').split(' ').filter(Boolean);
  return {
    id: String(row[0]),
    place: String(row[1]) as LibraryDocPlace,
    relPath: String(row[2]),
    path: String(row[3]),
    section: String(row[4]),
    title: String(row[5]),
    tags,
    updatedAt: String(row[7]),
    size: Number(row[8]),
  };
}

const DOC_COLUMNS = `d.id, d.place, d.rel_path, d.abs_path, d.section, d.title, d.tags, d.updated_at, d.size`;

function buildFilters(options: LibraryDocSearchOptions): { clauses: string[]; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (options.place) {
    clauses.push('d.place = ?');
    params.push(options.place);
  }
  if (options.section) {
    clauses.push('d.section = ?');
    params.push(options.section);
  }
  return { clauses, params };
}

export async function searchLibraryDocs(options: LibraryDocSearchOptions = {}): Promise<LibraryDocSearchResult[]> {
  const dbPath = libraryIndexPath();
  if (!fs.existsSync(dbPath)) return [];
  const db = await openDb(dbPath);
  try {
    initLibrarySchema(db);
    const query = options.query?.trim() ?? '';
    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const { clauses, params } = buildFilters(options);

    if (!query) {
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const rows = db.exec(
        `SELECT ${DOC_COLUMNS}, substr(d.body, 1, 240) AS snippet, 0 AS score
         FROM library_docs d
         ${where}
         ORDER BY d.mtime_ms DESC, d.rel_path ASC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );
      return (rows[0]?.values ?? []).map((row) => ({
        ...mapDocRow(row),
        snippet: compactSnippet(String(row[9] ?? '')),
        score: 0,
      }));
    }

    const where = ['library_docs_fts MATCH ?', ...clauses].join(' AND ');
    const rows = db.exec(
      `SELECT ${DOC_COLUMNS},
              snippet(library_docs_fts, 2, '', '', '…', 24) AS snippet,
              bm25(library_docs_fts, 10.0, 4.0, 1.0) AS score
       FROM library_docs d
       JOIN library_docs_fts ON library_docs_fts.rowid = d.rowid
       WHERE ${where}
       ORDER BY score ASC
       LIMIT ? OFFSET ?`,
      [sanitizeFtsQuery(query), ...params, limit, offset],
    );
    return (rows[0]?.values ?? []).map((row) => ({
      ...mapDocRow(row),
      snippet: compactSnippet(String(row[9] ?? '')),
      score: Number(row[10]),
    }));
  } finally {
    db.close();
  }
}

/**
 * Full body of one indexed document. Reads from the index rather than disk so a
 * caller cannot use an id to pull an arbitrary file off the filesystem.
 */
export async function getLibraryDocById(id: string): Promise<(LibraryDocRow & { body: string }) | null> {
  const dbPath = libraryIndexPath();
  if (!fs.existsSync(dbPath)) return null;
  const db = await openDb(dbPath);
  try {
    initLibrarySchema(db);
    const rows = db.exec(`SELECT ${DOC_COLUMNS}, d.body FROM library_docs d WHERE d.id = ?`, [id]);
    const row = rows[0]?.values[0];
    if (!row) return null;
    return { ...mapDocRow(row), body: String(row[9] ?? '') };
  } finally {
    db.close();
  }
}

export async function countLibraryDocs(options: LibraryDocSearchOptions = {}): Promise<number> {
  const dbPath = libraryIndexPath();
  if (!fs.existsSync(dbPath)) return 0;
  const db = await openDb(dbPath);
  try {
    initLibrarySchema(db);
    const query = options.query?.trim() ?? '';
    const { clauses, params } = buildFilters(options);
    const conditions = query ? ['library_docs_fts MATCH ?', ...clauses] : clauses;
    const join = query ? 'JOIN library_docs_fts ON library_docs_fts.rowid = d.rowid' : '';
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.exec(
      `SELECT COUNT(*) FROM library_docs d ${join} ${where}`,
      query ? [sanitizeFtsQuery(query), ...params] : params,
    );
    return Number(rows[0]?.values[0][0] ?? 0);
  } finally {
    db.close();
  }
}

export async function getLibraryIndexStats(): Promise<LibraryIndexStats> {
  const dbPath = libraryIndexPath();
  if (!fs.existsSync(dbPath)) return { total: 0, sections: [], lastUpdatedAt: null, indexed: false };
  const db = await openDb(dbPath);
  try {
    initLibrarySchema(db);
    const total = Number(db.exec(`SELECT COUNT(*) FROM library_docs`)[0]?.values[0][0] ?? 0);
    const sectionRows = db.exec(
      `SELECT section, COUNT(*) AS count FROM library_docs GROUP BY section ORDER BY count DESC, section ASC`,
    );
    const sections = (sectionRows[0]?.values ?? []).map((row) => ({
      section: String(row[0]),
      count: Number(row[1]),
    }));
    const latest = db.exec(`SELECT MAX(updated_at) FROM library_docs`)[0]?.values[0][0];
    return { total, sections, lastUpdatedAt: latest ? String(latest) : null, indexed: total > 0 };
  } finally {
    db.close();
  }
}

function compactSnippet(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 320 ? `${compact.slice(0, 317)}...` : compact;
}

export function formatLibraryDocResults(results: LibraryDocSearchResult[]): string {
  if (results.length === 0) return '(none)\n';
  return `${results.map((result) => {
    const head = `${result.relPath}  ${result.title}`;
    return result.snippet ? `${head}\n  ${result.snippet}` : head;
  }).join('\n')}\n`;
}
