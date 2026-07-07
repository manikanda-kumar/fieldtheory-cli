import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile, mkdir, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractGoalNowNext, extractReadmeDescription, scanProjects } from '../src/projects/scan.js';
import { buildProjectMarkdown, buildProjectsActiveMarkdown, rankActiveProjects } from '../src/projects/markdown.js';
import { syncProjects } from '../src/projects/sync.js';
import type { ProjectRecord } from '../src/projects/types.js';

const execFileAsync = promisify(execFile);

async function withTempDir(prefix: string, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withIsolatedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  await withTempDir('ft-projects-data-', async (dir) => {
    const previousData = process.env.FT_DATA_DIR;
    const previousLibrary = process.env.FT_LIBRARY_DIR;
    process.env.FT_DATA_DIR = dir;
    delete process.env.FT_LIBRARY_DIR;
    try {
      await fn(dir);
    } finally {
      if (previousData === undefined) delete process.env.FT_DATA_DIR;
      else process.env.FT_DATA_DIR = previousData;
      if (previousLibrary === undefined) delete process.env.FT_LIBRARY_DIR;
      else process.env.FT_LIBRARY_DIR = previousLibrary;
    }
  });
}

function makeRecord(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    repo: 'alpha',
    path: '/tmp/alpha',
    description: 'Alpha project description.',
    goalNowNext: {
      goal: 'Ship alpha',
      now: 'Writing scanner',
      next: 'Wire CLI',
    },
    lastCommitAt: '2026-07-06T12:00:00.000Z',
    pendingFiles: 0,
    unpushedCommits: 0,
    recentCommits: [
      { hash: 'abc123', date: '2026-07-06T12:00:00.000Z', subject: 'add scanner' },
    ],
    scannedAt: '2026-07-07T00:00:00.000Z',
    ...overrides,
  };
}

async function gitAvailable(): Promise<boolean> {
  try {
    await execFileAsync('git', ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd });
}

// ── CONTINUITY.md extraction ─────────────────────────────────────────────

test('projects: extracts Goal/Now/Next from bullet-headed continuity ledger sections', () => {
  const markdown = [
    'SESSION',
    '- Goal (incl. success criteria): Build the scanner',
    '  Include markdown output',
    '- Constraints/Assumptions: local only',
    '- Now: Implementing Step 1',
    '  Testing parser behavior',
    '- Next: Run build',
    '- Open questions: none',
  ].join('\n');

  assert.deepEqual(extractGoalNowNext(markdown), {
    goal: 'Build the scanner\n  Include markdown output',
    now: 'Implementing Step 1\n  Testing parser behavior',
    next: 'Run build',
  });
});

test('projects: extracts Goal/Now/Next from bare-label continuity ledger sections (no dash)', () => {
  const markdown = [
    'Goal (incl. success criteria):',
    '- ship the scanner',
    '- tests pass',
    'Constraints/Assumptions:',
    '- local only',
    'Now:',
    '- reviewing step 1',
    'Next:',
    '- step 2 sessions',
    'Open questions (UNCONFIRMED if needed):',
    '- none',
  ].join('\n');

  assert.deepEqual(extractGoalNowNext(markdown), {
    goal: '- ship the scanner\n- tests pass',
    now: '- reviewing step 1',
    next: '- step 2 sessions',
  });
});

test('projects: extracts Goal/Now/Next from bold bullet labels', () => {
  const markdown = [
    '# Continuity Ledger',
    '',
    '- **Goal:** Sync skills repo from GitHub stars.',
    '- **Constraints:** local only.',
    '- **Now:** wiring discovery.',
    '- **Next:** publish index.',
  ].join('\n');

  assert.deepEqual(extractGoalNowNext(markdown), {
    goal: 'Sync skills repo from GitHub stars.',
    now: 'wiring discovery.',
    next: 'publish index.',
  });
});

test('projects: extracts Goal/Now/Next from markdown headings and caps each section at 40 lines', () => {
  const fortyFive = Array.from({ length: 45 }, (_, index) => `line ${index + 1}`).join('\n');
  const markdown = [
    '## Goal',
    fortyFive,
    '## Now',
    'current work',
    '## Next',
    'next work',
    '## Other',
    'ignored',
  ].join('\n');

  const extracted = extractGoalNowNext(markdown);
  assert.ok(extracted);
  assert.equal(extracted.goal?.split('\n').length, 40);
  assert.equal(extracted.goal?.includes('line 41'), false);
  assert.equal(extracted.now, 'current work');
  assert.equal(extracted.next, 'next work');
});

// ── README extraction ────────────────────────────────────────────────────

test('projects: extracts README first non-heading non-badge paragraph', () => {
  const markdown = [
    '# Package',
    '',
    '[![CI](https://example.com/badge.svg)](https://example.com)',
    '',
    'A practical local-first project scanner.',
    'It reads repos and writes markdown.',
    '',
    'Second paragraph ignored.',
  ].join('\n');

  assert.equal(
    extractReadmeDescription(markdown),
    'A practical local-first project scanner. It reads repos and writes markdown.',
  );
});

test('projects: README description is capped at 400 chars', () => {
  const description = 'x'.repeat(450);
  assert.equal(extractReadmeDescription(description)?.length, 400);
});

// ── Active list and project markdown ─────────────────────────────────────

test('projects: active list ranking uses recency-weighted activity and caps output at 120 lines', () => {
  const now = new Date('2026-07-07T00:00:00.000Z');
  const records = [
    makeRecord({
      repo: 'older-many',
      lastCommitAt: '2026-06-24T00:00:00.000Z',
      recentCommits: Array.from({ length: 4 }, (_, index) => ({
        hash: `old${index}`,
        date: '2026-06-24T00:00:00.000Z',
        subject: `older commit ${index}`,
      })),
    }),
    makeRecord({
      repo: 'fresh',
      lastCommitAt: '2026-07-06T00:00:00.000Z',
      recentCommits: [
        { hash: 'fresh1', date: '2026-07-06T00:00:00.000Z', subject: 'fresh work' },
      ],
    }),
    ...Array.from({ length: 30 }, (_, index) => makeRecord({
      repo: `fixture-${String(index).padStart(2, '0')}`,
      lastCommitAt: '2026-07-01T00:00:00.000Z',
      recentCommits: [
        { hash: `fixture${index}`, date: '2026-07-01T00:00:00.000Z', subject: 'fixture work' },
      ],
    })),
  ];

  const ranked = rankActiveProjects(records, now);
  assert.equal(ranked[0].repo, 'fresh');

  const markdown = buildProjectsActiveMarkdown(records, { now });
  assert.ok(markdown.split('\n').length <= 120);
  assert.match(markdown, /^# Active Projects/);
  assert.match(markdown, /## fresh/);
});

test('projects: project markdown includes frontmatter, Goal/Now/Next, and recent commits', () => {
  const markdown = buildProjectMarkdown(makeRecord({
    repo: 'fieldtheory-cli',
    path: '/Users/example/Github/fieldtheory-cli',
    pendingFiles: 3,
    unpushedCommits: 2,
    goalNowNext: {
      goal: 'Implement local projects scanner',
      now: 'Writing tests',
      next: 'Run build',
    },
  }));

  assert.match(markdown, /^---\nrepo: "fieldtheory-cli"\npath: "\/Users\/example\/Github\/fieldtheory-cli"/);
  assert.match(markdown, /pending: 3/);
  assert.match(markdown, /unpushed: 2/);
  assert.match(markdown, /## Goal\nImplement local projects scanner/);
  assert.match(markdown, /## Now\nWriting tests/);
  assert.match(markdown, /## Next\nRun build/);
  assert.match(markdown, /## Recent commits\n- 2026-07-06 add scanner/);
});

// ── Integration scanner/sync tests ───────────────────────────────────────

test('projects: sync scans a real tiny git repo and writes JSONL plus markdown', async (t) => {
  if (!(await gitAvailable())) {
    t.skip('git is unavailable');
    return;
  }

  await withTempDir('ft-projects-root-', async (scanRoot) => {
    await withIsolatedDataDir(async (dataDir) => {
      const repoDir = path.join(scanRoot, 'tiny-repo');
      await mkdir(repoDir);
      await git(repoDir, ['init']);
      await git(repoDir, ['config', 'user.email', 'test@example.com']);
      await git(repoDir, ['config', 'user.name', 'Test User']);
      await writeFile(path.join(repoDir, 'README.md'), '# Tiny Repo\n\nA tiny integration fixture.\n', 'utf8');
      await writeFile(
        path.join(repoDir, 'CONTINUITY.md'),
        ['## Goal', 'Test project scanning', '## Now', 'Running integration test', '## Next', 'Assert outputs'].join('\n'),
        'utf8',
      );
      await git(repoDir, ['add', 'README.md', 'CONTINUITY.md']);
      await git(repoDir, ['commit', '-m', 'initial commit']);

      const result = await syncProjects({
        scanRoot,
        now: new Date('2026-07-07T00:00:00.000Z'),
        gitTimeoutMs: 5000,
      });

      assert.equal(result.records.length, 1);
      assert.equal(result.records[0].repo, 'tiny-repo');
      assert.equal(result.records[0].description, 'A tiny integration fixture.');
      assert.deepEqual(result.records[0].goalNowNext, {
        goal: 'Test project scanning',
        now: 'Running integration test',
        next: 'Assert outputs',
      });
      assert.equal(result.records[0].pendingFiles, 0);
      assert.equal(result.records[0].unpushedCommits, 0);
      assert.equal(result.errors.length, 0);

      const jsonlPath = path.join(dataDir, 'projects', 'projects.jsonl');
      const metaPath = path.join(dataDir, 'projects', 'meta.json');
      const projectMdPath = path.join(dataDir, 'md', 'projects', 'tiny-repo.md');
      const activeMdPath = path.join(dataDir, 'md', 'projects-active.md');
      assert.equal(existsSync(jsonlPath), true);
      assert.equal(existsSync(metaPath), true);
      assert.equal(existsSync(projectMdPath), true);
      assert.equal(existsSync(activeMdPath), true);

      const jsonl = await readFile(jsonlPath, 'utf8');
      assert.match(jsonl, /"repo":"tiny-repo"/);
      assert.match(await readFile(projectMdPath, 'utf8'), /## Now\nRunning integration test/);
      assert.match(await readFile(activeMdPath, 'utf8'), /## tiny-repo/);
    });
  });
});

test('projects: staleness pre-filter skips old repos before git commands', async (t) => {
  if (!(await gitAvailable())) {
    t.skip('git is unavailable');
    return;
  }

  await withTempDir('ft-projects-stale-', async (scanRoot) => {
    const repoDir = path.join(scanRoot, 'stale-repo');
    await mkdir(repoDir);
    await git(repoDir, ['init']);
    await writeFile(path.join(repoDir, 'README.md'), '# Stale\n\nShould be skipped.\n', 'utf8');
    const old = new Date('2026-01-01T00:00:00.000Z');
    await utimes(path.join(repoDir, '.git', 'HEAD'), old, old);
    if (existsSync(path.join(repoDir, '.git', 'index'))) {
      await utimes(path.join(repoDir, '.git', 'index'), old, old);
    }

    const result = await scanProjects({
      scanRoot,
      now: new Date('2026-07-07T00:00:00.000Z'),
      maxAgeDays: 30,
    });

    assert.equal(result.records.length, 0);
    assert.equal(result.errors.length, 0);
  });
});
