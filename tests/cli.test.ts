import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { compareVersions, runWithSpinner, buildCli, parseCookieOption, shouldDownloadSyncMedia } from '../src/cli.js';
import { dataDir } from '../src/paths.js';
import { skillWithFrontmatter } from '../src/skill.js';
import { rebuildCanonicalIndex } from '../src/canonical-bookmarks-db.js';

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origWrite = process.stdout.write;
  process.stdout.write = ((chunk: any, encodingOrCb?: any, cb?: any) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk));
    if (typeof encodingOrCb === 'function') encodingOrCb();
    if (typeof cb === 'function') cb();
    return true;
  }) as typeof process.stdout.write;

  try {
    await fn();
  } finally {
    process.stdout.write = origWrite;
  }

  return chunks.join('');
}

async function captureConsoleErrors(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origError = console.error;
  console.error = (...args: any[]) => { chunks.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.error = origError;
  }
  return chunks.join('\n');
}

test('showDashboard: prints update notice when cache is newer than local', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-dashboard-'));
  const origEnv = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = tmpDir;

  // Fresh cache file with an absurdly high version — exercises the cache-hit
  // path (no network), and guarantees the notice regardless of local version.
  fs.writeFileSync(path.join(tmpDir, '.update-check'), '99.99.99');

  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => { logs.push(args.map(String).join(' ')); };

  try {
    const { showDashboard } = await import('../src/cli.js');
    await showDashboard();
  } finally {
    console.log = origLog;
    process.env.FT_DATA_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const joined = logs.join('\n');
  assert.ok(
    joined.includes('Update available') && joined.includes('99.99.99'),
    `expected update notice mentioning the cached 99.99.99 version; got:\n${joined}`,
  );
});

test('ft wiki: --engine option is registered', () => {
  const program = buildCli();
  const wikiCmd = program.commands.find((c: any) => c.name() === 'wiki');
  assert.ok(wikiCmd, 'wiki command should be registered');
  const opts = wikiCmd.options.map((o: any) => o.long);
  assert.ok(opts.includes('--engine'), `expected --engine among ${opts.join(', ')}`);
});

test('ft search, stats, and status expose --json', () => {
  const program = buildCli();
  for (const name of ['search', 'stats', 'status']) {
    const cmd = program.commands.find((c: any) => c.name() === name);
    assert.ok(cmd, `${name} command should be registered`);
    const opts = cmd.options.map((o: any) => o.long);
    assert.ok(opts.includes('--json'), `expected --json on ft ${name}`);
  }
});

test('ft enrich-backfill exposes limit, dry-run, and all options', () => {
  const command = buildCli().commands.find((c: any) => c.name() === 'enrich-backfill');
  assert.ok(command, 'enrich-backfill command should be registered');
  const opts = command.options.map((option: any) => option.long);
  assert.deepEqual(opts, ['--limit', '--dry-run', '--all']);
});

test('ft paths, library, commands, app, and install command groups are registered', () => {
  const program = buildCli();
  for (const name of ['paths', 'library', 'commands', 'app', 'install']) {
    assert.ok(program.commands.find((c: any) => c.name() === name), `${name} command should be registered`);
  }
});

test('ft install app command is registered', () => {
  const program = buildCli();
  const installCmd = program.commands.find((c: any) => c.name() === 'install');
  assert.ok(installCmd, 'install command should be registered');
  const appCmd = installCmd.commands.find((c: any) => c.name() === 'app');
  assert.ok(appCmd, 'install app command should be registered');
  const opts = appCmd.options.map((o: any) => o.long);
  assert.ok(opts.includes('--install-dir'));
  assert.ok(opts.includes('--open'));
  assert.ok(opts.includes('--json'));
});

test('ft sync: media is off by default and exposes --media opt-in', () => {
  const program = buildCli();
  const syncCmd = program.commands.find((c: any) => c.name() === 'sync');
  assert.ok(syncCmd, 'sync command should be registered');

  assert.equal(syncCmd.opts().media, false, 'sync should default to skipping media');

  const mediaOption = syncCmd.options.find((o: any) => o.attributeName() === 'media');
  assert.ok(mediaOption, 'a media option must be registered');
  assert.equal(mediaOption.negate, false, 'the media option must be --media (non-negated)');
  assert.equal(mediaOption.long, '--media');
});

test('ft sync-browser: is deprecated and prints a notice', async () => {
  const program = buildCli();
  const syncBrowserCmd = program.commands.find((c: any) => c.name() === 'sync-browser');
  assert.ok(syncBrowserCmd, 'sync-browser command should be registered');
  const opts = syncBrowserCmd.options.map((o: any) => o.long);
  assert.ok(!opts.includes('--browser'), '--browser should not be advertised');
  assert.ok(!opts.includes('--profile'), '--profile should not be advertised');
  assert.ok(!opts.includes('--bookmarks-file'), '--bookmarks-file should not be advertised');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-sync-browser-deprecation-'));
  const origEnv = process.env.FT_DATA_DIR;
  const origExitCode = process.exitCode;
  process.env.FT_DATA_DIR = tmpDir;
  process.exitCode = undefined;
  fs.writeFileSync(path.join(tmpDir, '.update-check'), '0.0.0');

  try {
    const errors = await captureConsoleErrors(async () => {
      await buildCli().parseAsync(['node', 'ft', 'sync-browser']);
    });
    assert.ok(
      errors.includes('deprecated') || errors.includes('sync-raindrop'),
      `expected deprecation notice, got:\n${errors}`,
    );
    assert.equal(process.exitCode, 1);
  } finally {
    if (origEnv === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = origEnv;
    process.exitCode = origExitCode;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ft sync-raindrop: exposes expected options', () => {
  const program = buildCli();
  const syncRaindropCmd = program.commands.find((c: any) => c.name() === 'sync-raindrop');
  assert.ok(syncRaindropCmd, 'sync-raindrop command should be registered');
  const opts = syncRaindropCmd.options.map((o: any) => o.long);
  assert.ok(opts.includes('--rebuild'));
  assert.ok(opts.includes('--dry-run'));
  assert.ok(opts.includes('--classify'));
  assert.ok(opts.includes('--collections'));
});

test('ft sync-github-stars: exposes expected options', () => {
  const program = buildCli();
  const syncGitHubStarsCmd = program.commands.find((c: any) => c.name() === 'sync-github-stars');
  assert.ok(syncGitHubStarsCmd, 'sync-github-stars command should be registered');
  const opts = syncGitHubStarsCmd.options.map((o: any) => o.long);
  assert.ok(opts.includes('--rebuild'));
  assert.ok(opts.includes('--dry-run'));
  assert.ok(opts.includes('--limit'));
  assert.ok(opts.includes('--classify'));
});

test('ft sync-projects: exposes expected options', () => {
  const program = buildCli();
  const syncProjectsCmd = program.commands.find((c: any) => c.name() === 'sync-projects');
  assert.ok(syncProjectsCmd, 'sync-projects command should be registered');
  const opts = syncProjectsCmd.options.map((o: any) => o.long);
  assert.ok(opts.includes('--root'));
  assert.ok(opts.includes('--max-age-days'));
  assert.ok(opts.includes('--no-sessions'));
  assert.ok(opts.includes('--dry-run'));
});

test('ft sync-all: exposes unified refresh options', () => {
  const program = buildCli();
  const syncAllCmd = program.commands.find((c: any) => c.name() === 'sync-all');
  assert.ok(syncAllCmd, 'sync-all command should be registered');
  const opts = syncAllCmd.options.map((o: any) => o.long);
  assert.ok(opts.includes('--dry-run'));
  assert.ok(opts.includes('--x-list'));
  assert.ok(opts.includes('--playlist'));
  assert.ok(opts.includes('--youtube-limit'));
  assert.ok(opts.includes('--skip'));
  assert.ok(opts.includes('--only'));
  assert.ok(opts.includes('--no-synthesis'));
});

test('ft list --unified exposes --source filter', () => {
  const program = buildCli();
  const listCmd = program.commands.find((c: any) => c.name() === 'list');
  assert.ok(listCmd, 'list command should be registered');
  const opts = listCmd.options.map((o: any) => o.long);
  assert.ok(opts.includes('--unified'));
  assert.ok(opts.includes('--source'));
});

test('shouldDownloadSyncMedia enables media only when --media is truthy', () => {
  assert.equal(shouldDownloadSyncMedia({}), false);
  assert.equal(shouldDownloadSyncMedia({ media: false }), false);
  assert.equal(shouldDownloadSyncMedia({ media: true }), true);
});

test('ft wiki: description mentions engine prerequisite', () => {
  const program = buildCli();
  const wikiCmd = program.commands.find((c: any) => c.name() === 'wiki');
  assert.ok(wikiCmd);
  const desc = wikiCmd.description().toLowerCase();
  assert.ok(desc.includes('claude') && desc.includes('codex'));
});

test('ft classify: exposes --unified with --regex', () => {
  const program = buildCli();
  const classifyCmd = program.commands.find((c: any) => c.name() === 'classify');
  assert.ok(classifyCmd, 'classify command should be registered');
  const opts = classifyCmd.options.map((o: any) => o.long);
  assert.ok(opts.includes('--regex'));
  assert.ok(opts.includes('--unified'));
});

test('ft classify --unified requires --regex', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-classify-unified-'));
  const origEnv = process.env.FT_DATA_DIR;
  const origExitCode = process.exitCode;
  process.env.FT_DATA_DIR = tmpDir;
  process.exitCode = 0;

  try {
    const errors = await captureConsoleErrors(async () => {
      await buildCli().parseAsync(['node', 'ft', 'classify', '--unified']);
    });
    assert.ok(errors.includes('--unified currently supports only --regex'));
    assert.equal(process.exitCode, 1);
  } finally {
    if (origEnv === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = origEnv;
    process.exitCode = origExitCode;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ft classify --unified --regex runs canonical classification', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-classify-unified-'));
  const origEnv = process.env.FT_DATA_DIR;
  const origExitCode = process.exitCode;
  process.env.FT_DATA_DIR = tmpDir;
  process.exitCode = 0;

  try {
    await rebuildCanonicalIndex();
    const output = await captureStdout(async () => {
      await buildCli().parseAsync(['node', 'ft', 'classify', '--unified', '--regex']);
    });
    assert.match(output, /Unified bookmarks: \d+\/\d+ classified/);
    assert.equal(process.exitCode, 0);
  } finally {
    if (origEnv === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = origEnv;
    process.exitCode = origExitCode;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ft path: prints only the data directory', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-path-'));
  const origEnv = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = tmpDir;

  try {
    const output = await captureStdout(async () => {
      await buildCli().parseAsync(['node', 'ft', 'path']);
    });
    assert.equal(output, `${dataDir()}\n`);
  } finally {
    process.env.FT_DATA_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ft paths --json prints canonical roots', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-paths-'));
  const origEnv = {
    FT_DATA_DIR: process.env.FT_DATA_DIR,
    FT_LIBRARY_DIR: process.env.FT_LIBRARY_DIR,
    FT_COMMANDS_DIR: process.env.FT_COMMANDS_DIR,
  };
  process.env.FT_DATA_DIR = path.join(tmpDir, 'bookmarks');
  process.env.FT_LIBRARY_DIR = path.join(tmpDir, 'library');
  process.env.FT_COMMANDS_DIR = path.join(tmpDir, 'commands');
  fs.mkdirSync(process.env.FT_DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.FT_DATA_DIR, '.update-check'), '0.0.0');

  try {
    const output = await captureStdout(async () => {
      await buildCli().parseAsync(['node', 'ft', 'paths', '--json']);
    });
    const parsed = JSON.parse(output);
    assert.equal(parsed.canonical.bookmarksDir, process.env.FT_DATA_DIR);
    assert.equal(parsed.canonical.libraryDir, process.env.FT_LIBRARY_DIR);
    assert.equal(parsed.canonical.commandsDir, process.env.FT_COMMANDS_DIR);
  } finally {
    for (const [key, value] of Object.entries(origEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('ft skill show: prints only skill content', async () => {
  const output = await captureStdout(async () => {
    await buildCli().parseAsync(['node', 'ft', 'skill', 'show']);
  });

  assert.equal(output, skillWithFrontmatter());
});

test('compareVersions: equal versions return 0', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('compareVersions: newer patch returns positive', () => {
  assert.ok(compareVersions('1.2.4', '1.2.3') > 0);
});

test('compareVersions: older patch returns negative', () => {
  assert.ok(compareVersions('1.2.3', '1.2.4') < 0);
});

test('compareVersions: minor beats patch', () => {
  assert.ok(compareVersions('1.3.0', '1.2.9') > 0);
});

test('compareVersions: major beats minor', () => {
  assert.ok(compareVersions('2.0.0', '1.99.99') > 0);
});

test('compareVersions: handles double-digit segments', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
});

test('parseCookieOption: returns empty when no --cookies passed', () => {
  assert.deepEqual(parseCookieOption(undefined, {}), {});
  assert.deepEqual(parseCookieOption([], {}), {});
  assert.deepEqual(parseCookieOption('not-an-array', {}), {});
});

test('parseCookieOption: falls back to FT_X_CT0/FT_X_AUTH_TOKEN env', () => {
  const parsed = parseCookieOption(undefined, { FT_X_CT0: 'envct0', FT_X_AUTH_TOKEN: 'envauth' });
  assert.equal(parsed.csrfToken, 'envct0');
  assert.equal(parsed.cookieHeader, 'ct0=envct0; auth_token=envauth');
});

test('parseCookieOption: --cookies flag overrides env fallback', () => {
  const parsed = parseCookieOption(['flagct0'], { FT_X_CT0: 'envct0', FT_X_AUTH_TOKEN: 'envauth' });
  assert.equal(parsed.csrfToken, 'flagct0');
  assert.equal(parsed.cookieHeader, 'ct0=flagct0');
});

test('parseCookieOption: with only ct0, builds ct0-only header', () => {
  const parsed = parseCookieOption(['abc123']);
  assert.equal(parsed.csrfToken, 'abc123');
  assert.equal(parsed.cookieHeader, 'ct0=abc123');
});

test('parseCookieOption: with ct0 and auth_token, joins both', () => {
  const parsed = parseCookieOption(['abc123', 'auth_xyz']);
  assert.equal(parsed.csrfToken, 'abc123');
  assert.equal(parsed.cookieHeader, 'ct0=abc123; auth_token=auth_xyz');
});

test('parseCookieOption: coerces non-string array elements to strings', () => {
  const parsed = parseCookieOption([42, true]);
  assert.equal(parsed.csrfToken, '42');
  assert.equal(parsed.cookieHeader, 'ct0=42; auth_token=true');
});

test('runWithSpinner: stops spinner after success', async () => {
  let stopped = 0;

  const result = await runWithSpinner(
    { stop: () => { stopped += 1; } },
    async () => 'ok',
  );

  assert.equal(result, 'ok');
  assert.equal(stopped, 1);
});

test('runWithSpinner: stops spinner after error', async () => {
  let stopped = 0;

  await assert.rejects(
    runWithSpinner(
      { stop: () => { stopped += 1; } },
      async () => {
        throw new Error('boom');
      },
    ),
    /boom/,
  );

  assert.equal(stopped, 1);
});
