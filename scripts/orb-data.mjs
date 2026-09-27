#!/usr/bin/env node
// Git publication for the single-writer orb. The caller must hold sync-orb.lock.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.error?.message}`);
  return result.stdout.trimEnd();
}

export function refreshData(root) {
  if (git(root, 'branch', '--show-current') !== 'main') throw new Error('Data checkout must be on main.');
  if (git(root, 'status', '--porcelain')) throw new Error('Data checkout has unpublished edits; reconcile before refreshing.');
  git(root, 'fetch', 'origin', 'main');
  if (git(root, 'rev-list', '--count', 'origin/main..HEAD') !== '0') {
    throw new Error('Data checkout has unpublished commits; finish publication before refreshing.');
  }
  git(root, 'merge', '--ff-only', 'origin/main');
  git(root, 'lfs', 'pull', '--include=bookmarks/bookmarks.db', '--exclude=');
}

export function publishData(root) {
  if (git(root, 'branch', '--show-current') !== 'main') throw new Error('Data checkout must be on main.');
  if (git(root, 'diff', '--cached', '--name-only')) throw new Error('Existing staged changes must be reviewed first.');
  const tracked = git(root, 'diff', '--name-only', '-z').split('\0').filter(Boolean);
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const files = [...new Set([...tracked, ...untracked])];
  const committed = git(root, 'diff', '--name-only', '-z', 'origin/main...HEAD').split('\0').filter(Boolean);
  for (const file of [...files, ...committed]) {
    if (!/^(bookmarks|library)\//.test(file) || /^(?:bookmarks|library)\/projects(?:\/|$)|^library\/projects-active\.md$/.test(file)
      || /(?:^|\/)(?:\.env[^/]*|\.preferences|[^/]*(?:cookies|credentials|oauth-token|storage-state)[^/]*|[^/]*\.(?:pem|key))$/i.test(file)) {
      throw new Error(`Refusing to publish non-pipeline or sensitive path: ${file}`);
    }
  }
  const sidecars = fs.readdirSync(path.join(root, 'bookmarks'), { recursive: true })
    .filter((file) => /(?:-wal|-shm|\.db-journal)$/.test(String(file)));
  if (sidecars.length) throw new Error('SQLite sidecars exist; stop writers and checkpoint before publishing.');
  const check = spawnSync('python3', ['-c',
    'import pathlib,sqlite3,sys; p=pathlib.Path(sys.argv[1]); c=sqlite3.connect(p.as_uri()+"?mode=ro", uri=True); sys.exit(c.execute("PRAGMA quick_check").fetchall()!=[("ok",)])',
    path.join(root, 'bookmarks/bookmarks.db')], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error('SQLite integrity check failed; preserving local data without publication.');
  if (files.length) {
    git(root, 'add', '--', ...files);
    git(root, 'diff', '--cached', '--check');
    git(root, 'commit', '-m', `data: orb daily ${new Date().toISOString().slice(0, 10)}`);
  }
  // A non-fast-forward push is a hard stop, never an invitation to merge DBs.
  // Git LFS's pre-push hook uploads the database before advancing main.
  git(root, 'push', 'origin', 'HEAD:main');
  const local = git(root, 'rev-parse', 'HEAD');
  const remote = git(root, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0];
  if (local !== remote) throw new Error('Remote main does not match the published snapshot.');
  return local;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const root = path.join(os.homedir(), '.fieldtheory');
    if (process.argv[2] === 'refresh') refreshData(root);
    else if (process.argv[2] === 'publish') console.log(`Published data snapshot: ${publishData(root)}`);
    else throw new Error('Usage: node scripts/orb-data.mjs refresh|publish');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
