import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncAllPlan, formatSyncAllResult, runSyncAll } from '../src/sync-all.js';

test('buildSyncAllPlan supports dry-run planning with optional context sources', () => {
  const savedKey = process.env.TWEETSMASH_API_KEY;
  delete process.env.TWEETSMASH_API_KEY;
  try {
    const withKeyPlan = (() => {
      process.env.TWEETSMASH_API_KEY = 'k';
      const plan = buildSyncAllPlan({ dryRun: true, noSynthesis: true });
      delete process.env.TWEETSMASH_API_KEY;
      return plan;
    })();
    assert.equal(withKeyPlan.find((step) => step.id === 'tweetsmash')?.enabled, true);
    assert.deepEqual(withKeyPlan.find((step) => step.id === 'tweetsmash')?.command, ['sync-tweetsmash', '--no-index']);
    runPlanAssertions();
  } finally {
    if (savedKey !== undefined) process.env.TWEETSMASH_API_KEY = savedKey;
    else delete process.env.TWEETSMASH_API_KEY;
  }
});

function runPlanAssertions(): void {
  const plan = buildSyncAllPlan({ dryRun: true, xList: '123', playlist: 'PL1', youtubeLimit: 3, noSynthesis: true });

  assert.deepEqual(plan.filter((step) => step.enabled).map((step) => step.id), [
    'following',
    'x',
    'x-list',
    'raindrop',
    'github-stars',
    'rss',
    'projects',
    'youtube',
    'canonical-index',
  ]);
  assert.deepEqual(plan.find((step) => step.id === 'youtube')?.command, ['sync-youtube', '--playlist', 'PL1', '--limit', '3']);
  // Plain incremental sync: --continue resumes a saved deep cursor, which on a
  // nightly schedule can pin the sync at the timeline tail and miss new saves.
  assert.deepEqual(plan.find((step) => step.id === 'x')?.command, ['sync']);
  assert.equal(plan.find((step) => step.id === 'canonical-md')?.enabled, false);
  assert.equal(plan.find((step) => step.id === 'daily')?.enabled, false);
}

test('buildSyncAllPlan classifies the X table when --classify is on', () => {
  const off = buildSyncAllPlan({ noSynthesis: true });
  assert.equal(off.find((step) => step.id === 'x-classify')?.enabled, false);

  const plan = buildSyncAllPlan({ classify: true });
  const step = plan.find((item) => item.id === 'x-classify');
  assert.equal(step?.enabled, true);
  assert.deepEqual(step?.command, ['classify', '--regex']);
  const ids = plan.map((item) => item.id);
  assert.ok(ids.indexOf('x-classify') > ids.indexOf('x'), 'X classification runs after the X sync');
  assert.ok(ids.indexOf('x-classify') < ids.indexOf('canonical-index'), 'X classification runs before the canonical rebuild');

  const skipped = buildSyncAllPlan({ classify: true, skip: ['x'] });
  assert.equal(skipped.find((item) => item.id === 'x-classify')?.enabled, false);
});

test('buildSyncAllPlan runs the daily digest step in the synthesis tail', () => {
  const plan = buildSyncAllPlan({});
  const dailyStep = plan.find((step) => step.id === 'daily');
  assert.equal(dailyStep?.enabled, true);
  assert.deepEqual(dailyStep?.command, ['daily', '--write', '--epub']);
  const ids = plan.map((step) => step.id);
  assert.ok(ids.indexOf('daily') > ids.indexOf('canonical-md'), 'daily runs after canonical markdown export');
});

test('buildSyncAllPlan honors --only and --skip source filters', () => {
  const plan = buildSyncAllPlan({ only: 'github-stars,raindrop,projects,youtube', skip: ['youtube'], noSynthesis: true });

  assert.equal(plan.find((step) => step.id === 'github-stars')?.enabled, true);
  assert.equal(plan.find((step) => step.id === 'raindrop')?.enabled, true);
  assert.equal(plan.find((step) => step.id === 'projects')?.enabled, true);
  assert.equal(plan.find((step) => step.id === 'youtube')?.enabled, false);
  assert.match(plan.find((step) => step.id === 'x')?.reason ?? '', /not selected/);
  assert.equal(plan.find((step) => step.id === 'canonical-index')?.enabled, true);
});

test('runSyncAll isolates source failures and still runs canonical rebuild', async () => {
  const commands: string[][] = [];
  const result = await runSyncAll({ only: 'raindrop,github-stars', noSynthesis: true, retries: 0 }, {
    async run(command) {
      commands.push(command);
      return { exitCode: command[0] === 'sync-raindrop' ? 1 : 0 };
    },
  });

  assert.equal(result.ok, false);
  assert.deepEqual(commands.map((command) => command[0]), ['sync-raindrop', 'sync-github-stars', 'index']);
  assert.equal(result.steps.find((step) => step.id === 'raindrop')?.status, 'failed');
  assert.equal(result.steps.find((step) => step.id === 'canonical-index')?.status, 'ok');
});

test('runSyncAll retries a failed network step and reports the winning attempt', async () => {
  const commands: string[][] = [];
  const waits: number[] = [];
  const result = await runSyncAll({ only: 'raindrop', noSynthesis: true }, {
    async run(command) {
      commands.push(command);
      const attempt = commands.filter((entry) => entry[0] === 'sync-raindrop').length;
      return { exitCode: command[0] === 'sync-raindrop' && attempt < 3 ? 1 : 0 };
    },
  }, async (ms) => {
    waits.push(ms);
  });

  assert.equal(result.ok, true);
  assert.deepEqual(commands.map((command) => command[0]), ['sync-raindrop', 'sync-raindrop', 'sync-raindrop', 'index']);
  assert.deepEqual(waits, [20_000, 60_000]);
  const raindrop = result.steps.find((step) => step.id === 'raindrop');
  assert.equal(raindrop?.status, 'ok');
  assert.equal(raindrop?.attempts, 3);
  assert.match(formatSyncAllResult(result), /Sync Raindrop bookmarks {2}ft sync-raindrop after 3 attempts/);
});

test('runSyncAll gives up after the retry budget and never retries local steps', async () => {
  const commands: string[][] = [];
  const result = await runSyncAll({ only: 'projects', noSynthesis: true, retryDelayMs: 0 }, {
    async run(command) {
      commands.push(command);
      return { exitCode: command[0] === 'index' ? 1 : 0 };
    },
  }, async () => {});

  // `index` is required but not network-backed: one attempt, no retry.
  assert.deepEqual(commands.map((command) => command[0]), ['sync-projects', 'index']);
  assert.equal(result.steps.find((step) => step.id === 'canonical-index')?.attempts, 1);

  const flaky: string[][] = [];
  const exhausted = await runSyncAll({ only: 'x-list', xList: '123', noSynthesis: true, retryDelayMs: 0 }, {
    async run(command) {
      flaky.push(command);
      return { exitCode: command[0] === 'x-list' ? 1 : 0 };
    },
  }, async () => {});

  assert.equal(exhausted.ok, false);
  assert.equal(flaky.filter((command) => command[0] === 'x-list').length, 3);
  const xList = exhausted.steps.find((step) => step.id === 'x-list');
  assert.equal(xList?.status, 'failed');
  assert.equal(xList?.attempts, 3);
  assert.match(formatSyncAllResult(exhausted), /failed \(1\) after 3 attempts/);
});

test('runSyncAll retries a thrown runner error too', async () => {
  let calls = 0;
  const result = await runSyncAll({ only: 'github-stars', noSynthesis: true, retryDelayMs: 0 }, {
    async run(command) {
      if (command[0] !== 'sync-github-stars') return { exitCode: 0 };
      calls += 1;
      if (calls === 1) throw new Error('fetch failed');
      return { exitCode: 0 };
    },
  }, async () => {});

  assert.equal(calls, 2);
  assert.equal(result.ok, true);
  assert.equal(result.steps.find((step) => step.id === 'github-stars')?.attempts, 2);
});

test('buildSyncAllPlan places projects after RSS and before YouTube', () => {
  const plan = buildSyncAllPlan({ playlist: 'PL1', noSynthesis: true });
  assert.deepEqual(
    plan.filter((step) => ['github-stars', 'rss', 'projects', 'youtube'].includes(step.id)).map((step) => [step.id, step.command[0]]),
    [
      ['github-stars', 'sync-github-stars'],
      ['rss', 'sync-rss'],
      ['projects', 'sync-projects'],
      ['youtube', 'sync-youtube'],
    ],
  );
});

test('formatSyncAllResult prints skipped prerequisites and failures', () => {
  const text = formatSyncAllResult({
    dryRun: false,
    ok: false,
    steps: [
      { id: 'youtube', label: 'Sync YouTube playlist', source: 'youtube', command: ['sync-youtube', '--playlist', ''], enabled: false, status: 'skipped', reason: 'pass --playlist <url-or-id> to include' },
      { id: 'github-stars', label: 'Sync GitHub stars', source: 'github-stars', command: ['sync-github-stars'], enabled: true, status: 'failed', exitCode: 1 },
    ],
  });

  assert.match(text, /pass --playlist/);
  assert.match(text, /failed \(1\)/);
  assert.match(text, /later steps still ran/);
});
