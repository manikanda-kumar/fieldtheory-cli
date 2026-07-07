import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncAllPlan, formatSyncAllResult, runSyncAll } from '../src/sync-all.js';

test('buildSyncAllPlan supports dry-run planning with optional context sources', () => {
  const plan = buildSyncAllPlan({ dryRun: true, xList: '123', playlist: 'PL1', youtubeLimit: 3, noSynthesis: true });

  assert.deepEqual(plan.filter((step) => step.enabled).map((step) => step.id), [
    'following',
    'x',
    'x-list',
    'raindrop',
    'github-stars',
    'projects',
    'youtube',
    'canonical-index',
  ]);
  assert.deepEqual(plan.find((step) => step.id === 'youtube')?.command, ['sync-youtube', '--playlist', 'PL1', '--limit', '3']);
  assert.equal(plan.find((step) => step.id === 'canonical-md')?.enabled, false);
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
  const result = await runSyncAll({ only: 'raindrop,github-stars', noSynthesis: true }, {
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

test('buildSyncAllPlan places projects after GitHub stars and before YouTube', () => {
  const plan = buildSyncAllPlan({ playlist: 'PL1', noSynthesis: true });
  assert.deepEqual(
    plan.filter((step) => ['github-stars', 'projects', 'youtube'].includes(step.id)).map((step) => [step.id, step.command[0]]),
    [
      ['github-stars', 'sync-github-stars'],
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
