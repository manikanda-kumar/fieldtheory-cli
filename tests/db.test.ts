import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireDbLock, openDb, releaseDbLock, saveDb } from '../src/db.js';

function tempDbPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ft-db-')), 'bookmarks.db');
}

async function writeValue(dbPath: string, key: string, value: string): Promise<void> {
  const lock = await acquireDbLock(dbPath);
  const db = await openDb(dbPath);
  try {
    db.run('CREATE TABLE IF NOT EXISTS entries (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.run('INSERT INTO entries VALUES (?, ?)', [key, value]);
    saveDb(db, dbPath);
  } finally {
    db.close();
    releaseDbLock(lock);
  }
}

test('database locks preserve sequential writers', async () => {
  const dbPath = tempDbPath();
  try {
    await writeValue(dbPath, 'first', 'one');
    await writeValue(dbPath, 'second', 'two');
    const db = await openDb(dbPath);
    try {
      assert.deepEqual(db.exec('SELECT key, value FROM entries ORDER BY key')[0]?.values, [['first', 'one'], ['second', 'two']]);
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('database lock contention times out with its lock path', async () => {
  const dbPath = tempDbPath();
  const held = await acquireDbLock(dbPath);
  try {
    await assert.rejects(
      acquireDbLock(dbPath, { timeoutMs: 20, pollIntervalMs: 5 }),
      new RegExp(`Timed out waiting for database lock: ${dbPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.lock`),
    );
  } finally {
    releaseDbLock(held);
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});

test('database lock steals stale lock files', async () => {
  const dbPath = tempDbPath();
  const lockPath = `${dbPath}.lock`;
  try {
    fs.writeFileSync(lockPath, JSON.stringify({ pid: 1, createdAt: '2000-01-01T00:00:00.000Z' }));
    const old = new Date(Date.now() - 1_000);
    fs.utimesSync(lockPath, old, old);
    const lock = await acquireDbLock(dbPath, { staleAfterMs: 1 });
    assert.equal(lock.path, lockPath);
    releaseDbLock(lock);
  } finally {
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  }
});
