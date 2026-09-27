import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { publishData, refreshData } from '../scripts/orb-data.mjs';

function fixture(t: test.TestContext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-publish-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const remote = path.join(dir, 'remote.git');
  const root = path.join(dir, 'data');
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  fs.mkdirSync(root);
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  git('init', '--initial-branch=main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'commit.gpgsign', 'false');
  git('remote', 'add', 'origin', remote);
  fs.mkdirSync(path.join(root, 'bookmarks'));
  fs.mkdirSync(path.join(root, 'library'));
  fs.writeFileSync(path.join(root, 'bookmarks/items.jsonl'), 'initial\n');
  execFileSync('python3', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("CREATE TABLE fixture(id INTEGER)"); c.close()', path.join(root, 'bookmarks/bookmarks.db')]);
  git('add', '.'); git('commit', '-m', 'initial'); git('push', '-u', 'origin', 'main');
  return { root, remote, git };
}

test('orb publication commits only data and verifies the remote', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'library/new.md'), '# New\n');
  const commit = publishData(f.root);
  assert.equal(f.git('rev-parse', 'HEAD'), commit);
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], commit);
  assert.equal(f.git('status', '--porcelain'), '');
  assert.equal(publishData(f.root), commit, 'retry after successful publication adds no empty commit');
});

test('orb publication rejects unrelated files, credential paths, staged edits, and SQLite sidecars', (t) => {
  const f = fixture(t);
  for (const file of ['sync-all.sh', 'bookmarks/credentials.json', 'library/projects/local.md', 'bookmarks/bookmarks.db-wal']) {
    const dest = path.join(f.root, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'fixture');
    assert.throws(() => publishData(f.root), /Refusing|sidecars/);
    assert.equal(f.git('diff', '--cached', '--name-only'), '');
    fs.rmSync(dest);
  }
  fs.writeFileSync(path.join(f.root, 'library/staged.md'), 'staged');
  f.git('add', 'library/staged.md');
  assert.throws(() => publishData(f.root), /staged changes/);
});

test('orb refresh refuses dirty state and publication preserves commits on a remote race', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'library/local.md'), 'local');
  assert.throws(() => refreshData(f.root), /unpublished edits/);
  const other = path.join(path.dirname(f.root), 'other');
  execFileSync('git', ['clone', f.remote, other], { stdio: 'ignore' });
  const otherGit = (...args: string[]) => execFileSync('git', ['-C', other, ...args], { stdio: 'ignore' });
  otherGit('config', 'user.name', 'Fixture'); otherGit('config', 'user.email', 'fixture@example.test');
  otherGit('config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(other, 'bookmarks/items.jsonl'), 'remote advance\n');
  otherGit('add', '.'); otherGit('commit', '-m', 'remote advance'); otherGit('push');
  assert.throws(() => publishData(f.root), /push failed/);
  assert.equal(f.git('show', 'HEAD:library/local.md'), 'local');
  assert.throws(() => refreshData(f.root), /unpublished commits/);
});

test('orb publication rejects a corrupt database without staging it', (t) => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'bookmarks/bookmarks.db'), 'not SQLite');
  assert.throws(() => publishData(f.root), /integrity check failed/);
  assert.equal(f.git('diff', '--cached', '--name-only'), '');
});
