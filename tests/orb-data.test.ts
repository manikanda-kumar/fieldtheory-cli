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

function collectorSnapshot(f: ReturnType<typeof fixture>) {
  f.git('checkout', '-b', 'mac-collectors');
  for (const [file, content] of Object.entries({
    'bookmarks/projects/projects.jsonl': '{"repo":"new-project"}\n',
    'bookmarks/projects/meta.json': '{"lastSyncedAt":"2026-09-28T02:30:00Z"}\n',
    'library/projects/new.md': '# New Mac project\n',
    'library/projects-active.md': '# Active projects\n',
  })) {
    fs.mkdirSync(path.dirname(path.join(f.root, file)), { recursive: true });
    fs.writeFileSync(path.join(f.root, file), content);
  }
}

test('refresh imports only project snapshots, handles deletions, and publishes once before ingestion', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'library/projects'));
  fs.writeFileSync(path.join(f.root, 'library/projects/old.md'), '# Retired\n');
  f.git('add', '.'); f.git('commit', '-m', 'old project'); f.git('push');
  const database = fs.readFileSync(path.join(f.root, 'bookmarks/bookmarks.db'));
  collectorSnapshot(f);
  fs.rmSync(path.join(f.root, 'library/projects/old.md'));
  // The collector branch may carry stale canonical data and unrelated files.
  fs.writeFileSync(path.join(f.root, 'bookmarks/bookmarks.db'), 'must not import');
  fs.writeFileSync(path.join(f.root, 'bookmarks/items.jsonl'), 'must not import');
  fs.writeFileSync(path.join(f.root, 'bookmarks/projects/cookies.json'), 'must not import');
  f.git('add', '.'); f.git('commit', '-m', 'collector'); f.git('push', 'origin', 'mac-collectors');
  f.git('checkout', 'main');
  refreshData(f.root);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'bookmarks/bookmarks.db')), database);
  assert.equal(fs.readFileSync(path.join(f.root, 'bookmarks/items.jsonl'), 'utf8'), 'initial\n');
  assert.equal(fs.existsSync(path.join(f.root, 'bookmarks/projects/cookies.json')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'library/projects/old.md')), false);
  assert.equal(fs.readFileSync(path.join(f.root, 'library/projects/new.md'), 'utf8'), '# New Mac project\n');
  assert.equal(f.git('diff', 'origin/mac-collectors', 'HEAD', '--', 'bookmarks/projects/projects.jsonl', 'bookmarks/projects/meta.json', 'library/projects', 'library/projects-active.md'), '');
  assert.equal(f.git('status', '--porcelain'), '');
  const commit = f.git('rev-parse', 'HEAD');
  assert.equal(f.git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], commit);
  refreshData(f.root);
  assert.equal(f.git('rev-parse', 'HEAD'), commit, 'unchanged collector creates no empty commit');
  fs.writeFileSync(path.join(f.root, 'library/daily.md'), '# Digest\n');
  assert.doesNotThrow(() => publishData(f.root), 'normal publication works after isolated project import');
});

test('refresh rejects absent, incomplete, or symlinked collector snapshots before staging', (t) => {
  for (const failure of ['absent', 'incomplete', 'symlink']) {
    const f = fixture(t);
    const original = f.git('rev-parse', 'HEAD');
    if (failure !== 'absent') {
      collectorSnapshot(f);
      if (failure === 'incomplete') fs.rmSync(path.join(f.root, 'bookmarks/projects/meta.json'));
      else {
        fs.rmSync(path.join(f.root, 'library/projects/new.md'));
        fs.symlinkSync('/tmp/outside-projects', path.join(f.root, 'library/projects/new.md'));
      }
      f.git('add', '.'); f.git('commit', '-m', 'bad collector'); f.git('push', 'origin', 'mac-collectors');
      f.git('checkout', 'main');
    }
    assert.throws(() => refreshData(f.root), /fetch failed|Incomplete collector|regular non-executable/);
    assert.equal(f.git('status', '--porcelain'), '');
    assert.equal(f.git('rev-parse', 'HEAD'), original);
    assert.equal(f.git('ls-remote', 'origin', 'refs/heads/main').split(/\s/)[0], original);
  }
});
