import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t: test.TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-orb-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  for (const dir of ['scripts', 'dist', '.local/bin', '.fieldtheory/bookmarks/youtube']) {
    fs.mkdirSync(path.join(home, dir), { recursive: true });
  }
  const script = path.join(home, 'scripts/sync-orb.sh');
  fs.copyFileSync(new URL('../scripts/sync-orb.sh', import.meta.url), script);
  fs.writeFileSync(path.join(home, 'dist/cli.js'), '');
  fs.writeFileSync(path.join(home, '.fieldtheory/bookmarks/bookmarks.db'), 'SQLite format 3\0');
  fs.writeFileSync(path.join(home, '.fieldtheory/bookmarks/youtube/state.json'), '{}');
  fs.writeFileSync(path.join(home, '.fieldtheory/bookmarks/.preferences'), '{"defaultEngine":"claude"}');
  for (const tool of ['gh', 'claude', 'git-lfs', 'yt-dlp']) {
    fs.writeFileSync(path.join(home, '.local/bin', tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  fs.writeFileSync(path.join(home, '.local/bin/node'), `#!${process.execPath}
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === '--input-type=module') {
  process.exit(spawnSync(${JSON.stringify(process.execPath)}, args, {stdio:'inherit'}).status ?? 1);
}
console.log(JSON.stringify({args, tz:process.env.TZ, data:process.env.FT_DATA_DIR}));
process.exit(Number(process.env.TEST_CLI_EXIT || 0));
`, { mode: 0o755 });
  const env = { ...process.env, HOME: home, RAINDROP_TOKEN: 'fixture', TWEETSMASH_API_KEY: 'fixture' };
  const run = (...args: string[]) => spawnSync('bash', [script, ...args], { env, encoding: 'utf8' });
  return { home, script, env, run };
}

test('orb dry run bypasses auth/data checks and excludes Mac hooks and X', { skip: process.platform !== 'linux' }, (t) => {
  const f = fixture(t);
  fs.rmSync(path.join(f.home, '.fieldtheory'), { recursive: true });
  fs.writeFileSync(path.join(f.home, '.local/bin/claude'), '#!/bin/sh\nexit 99\n');
  const result = f.run('--dry-run');
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.args.slice(1), ['sync-all', '--only', 'raindrop,tweetsmash,github-stars,rss,youtube',
    '--playlist', 'PLVmtzF5bqCTLutxk2SQvcH2SgCjwNWobk', '--playlist', 'UULKPca3kwwd-B59HNr-_lvA',
    '--youtube-limit', '20', '--classify', '--dry-run']);
  assert.equal(output.tz, 'Asia/Calcutta');
  assert.equal(output.data, undefined, 'use canonical home paths, not an override that relocates mirrored context');
  assert.equal(fs.existsSync(path.join(f.home, '.fieldtheory')), false);
});

test('orb preflight accepts hydrated state, rejects LFS pointer, and never ingests', { skip: process.platform !== 'linux' }, (t) => {
  const f = fixture(t);
  assert.equal(f.run('--check').status, 0);
  assert.doesNotMatch(f.run('--check').stdout, /"args"/);
  fs.writeFileSync(path.join(f.home, '.fieldtheory/bookmarks/bookmarks.db'), 'version https://git-lfs.github.com/spec/v1');
  const result = f.run('--run');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /hydrate private data/);
  assert.doesNotMatch(result.stdout, /"args"/);
});

test('orb rejects unknown arguments, prevents overlap, and propagates pipeline failures', { skip: process.platform !== 'linux' }, (t) => {
  const f = fixture(t);
  assert.equal(f.run('--dry-run', '--run').status, 2);
  const locked = spawnSync('flock', [path.join(f.home, '.fieldtheory/sync-orb.lock'), 'bash', f.script, '--run'], {
    env: f.env, encoding: 'utf8',
  });
  assert.equal(locked.status, 1);
  assert.match(locked.stderr, /Another orb sync/);
  const failed = spawnSync('bash', [f.script, '--run'], {
    env: { ...f.env, TEST_CLI_EXIT: '7' }, encoding: 'utf8',
  });
  assert.equal(failed.status, 7);
});

test('orb daily mode requires handoff and reports RSS failures after publishing good data', { skip: process.platform !== 'linux' }, (t) => {
  const f = fixture(t);
  const blocked = f.run('--daily');
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /handoff has not been verified/);
  assert.doesNotMatch(blocked.stdout, /"args"/);
  fs.mkdirSync(path.join(f.home, '.config/fieldtheory'), { recursive: true });
  fs.writeFileSync(path.join(f.home, '.config/fieldtheory/orb-canonical-writer'), 'verified');
  fs.mkdirSync(path.join(f.home, '.fieldtheory/bookmarks/rss'));
  fs.writeFileSync(path.join(f.home, '.fieldtheory/bookmarks/rss/meta.json'), JSON.stringify({ feeds: [
    { name: 'working', lastError: null }, { name: 'blocked', lastError: 'HTTP 403' },
  ] }));
  const result = f.run('--daily');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /RSS failure: blocked: HTTP 403/);
  const calls = result.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line).args);
  assert.deepEqual(calls.map(args => args[1]), ['refresh', 'sync-all', 'publish']);
});
