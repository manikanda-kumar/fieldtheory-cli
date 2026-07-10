import type { Database, SqlJsStatic } from 'sql.js';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

let sqlPromise: Promise<SqlJsStatic> | undefined;
const LOCK_STALE_MS = 10 * 60 * 1000;
const LOCK_TIMEOUT_MS = 2 * 60 * 1000;
const LOCK_POLL_MS = 250;

export interface DbLockOptions {
  staleAfterMs?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface DbLock {
  path: string;
}

function getSql(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    const initSqlJs = require('sql.js-fts5') as (opts: any) => Promise<SqlJsStatic>;
    const wasmPath = require.resolve('sql.js-fts5/dist/sql-wasm.wasm');
    const wasmBinary = fs.readFileSync(wasmPath);
    sqlPromise = initSqlJs({ wasmBinary });
  }
  return sqlPromise!;
}

export async function openDb(filePath: string): Promise<Database> {
  const SQL = await getSql();
  if (fs.existsSync(filePath)) {
    const buf = fs.readFileSync(filePath);
    return new SQL.Database(buf);
  }
  return new SQL.Database();
}

export async function createDb(): Promise<Database> {
  const SQL = await getSql();
  return new SQL.Database();
}

export function saveDb(db: Database, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const data = db.export();
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;

  // Crash-durable write: openSync → writeSync → fsyncSync → close → rename → fsync parent dir.
  // On power loss, the target file either has the old content or the full new content —
  // never a zero-byte or partially-written bookmarks.db.
  const fd = fs.openSync(tmp, 'w', 0o600);
  try {
    fs.writeSync(fd, Buffer.from(data));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);

  try {
    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch {
    // Windows can't open a dir for fsync — the file fsync above is the critical guarantee.
  }
}

export async function acquireDbLock(filePath: string, options: DbLockOptions = {}): Promise<DbLock> {
  const lockPath = `${filePath}.lock`;
  const staleAfterMs = options.staleAfterMs ?? LOCK_STALE_MS;
  const timeoutMs = options.timeoutMs ?? LOCK_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? LOCK_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  while (true) {
    try {
      const fd = fs.openSync(lockPath, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      return { path: lockPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (isStaleLock(lockPath, staleAfterMs)) {
        console.warn(`Stealing stale database lock: ${lockPath}`);
        try { fs.unlinkSync(lockPath); } catch (unlinkError) {
          if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError;
        }
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for database lock: ${lockPath}`);
      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}

export function releaseDbLock(lock: DbLock): void {
  try {
    fs.unlinkSync(lock.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

function isStaleLock(lockPath: string, staleAfterMs: number): boolean {
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs > staleAfterMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
