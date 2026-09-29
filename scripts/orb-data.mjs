#!/usr/bin/env node
// Git publication for the single-writer orb. The caller must hold sync-orb.lock.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim() || result.error?.message || result.status}`);
  return result.stdout.trimEnd();
}

function pushSnapshot(root) {
  // Never merge a remote race, especially one involving the SQLite database.
  git(root, 'push', 'origin', 'HEAD:main');
  const local = git(root, 'rev-parse', 'HEAD');
  const remote = git(root, 'ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0];
  if (local !== remote) throw new Error('Remote main does not match the published snapshot.');
  return local;
}

function projectFiles(root, ref) {
  const files = new Set();
  for (const entry of git(root, 'ls-tree', '-r', '-z', ref, '--',
    'bookmarks/projects', 'library/projects', 'library/projects-active.md').split('\0').filter(Boolean)) {
    const tab = entry.indexOf('\t');
    const file = entry.slice(tab + 1);
    if (!/^(?:bookmarks\/projects\/(?:projects\.jsonl|meta\.json)|library\/projects\/[^/]+\.md|library\/projects-active\.md)$/.test(file)) continue;
    if (!entry.startsWith('100644 blob ')) throw new Error(`Project snapshot must be a regular non-executable file: ${file}`);
    files.add(file);
  }
  return files;
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
  // Import only the collector's project snapshots, never its DB or branch history.
  git(root, 'fetch', 'origin', 'refs/heads/mac-collectors:refs/remotes/origin/mac-collectors');
  const source = git(root, 'rev-parse', 'origin/mac-collectors');
  const incoming = projectFiles(root, source);
  for (const required of ['bookmarks/projects/projects.jsonl', 'bookmarks/projects/meta.json', 'library/projects-active.md']) {
    if (!incoming.has(required)) throw new Error(`Incomplete collector snapshot: missing ${required}`);
  }
  const files = [...new Set([...projectFiles(root, 'HEAD'), ...incoming])];
  git(root, '--literal-pathspecs', 'restore', '--source', source, '--staged', '--worktree', '--', ...files);
  if (git(root, 'diff', '--cached', '--name-only')) {
    git(root, 'commit', '-m', `data: import Mac project snapshots from ${source}`);
    pushSnapshot(root);
  }
}

export function publishData(root) {
  if (git(root, 'branch', '--show-current') !== 'main') throw new Error('Data checkout must be on main.');
  if (git(root, 'diff', '--cached', '--name-only')) throw new Error('Existing staged changes must be reviewed first.');
  const tracked = git(root, 'diff', '--name-only', '-z').split('\0').filter(Boolean);
  const untracked = git(root, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
  const files = [...new Set([...tracked, ...untracked])];
  const committed = git(root, 'diff', '--name-only', '-z', 'origin/main...HEAD').split('\0').filter(Boolean);
  for (const file of [...files, ...committed]) {
    // Exported article titles may discuss credentials or cookies. Limit this
    // exception to the dated Markdown naming contract in library/bookmarks.
    const bookmarkArticle = /^library\/bookmarks\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/.test(file);
    if (!/^(bookmarks|library)\//.test(file) || /^(?:bookmarks|library)\/projects(?:\/|$)|^library\/projects-active\.md$/.test(file)
      || /(?:^|\/)(?:\.env[^/]*|\.preferences|[^/]*\.(?:pem|key))$/i.test(file)
      || (!bookmarkArticle && /(?:^|\/)[^/]*(?:cookies|credentials|oauth-token|storage-state)[^/]*$/i.test(file))) {
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
    // Imported prose is data: preserve whitespace rather than applying code-style checks.
    git(root, 'commit', '-m', `data: orb daily ${new Date().toISOString().slice(0, 10)}`);
  }
  // A non-fast-forward push is a hard stop, never an invitation to merge DBs.
  // Git LFS's pre-push hook uploads the database before advancing main.
  return pushSnapshot(root);
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
