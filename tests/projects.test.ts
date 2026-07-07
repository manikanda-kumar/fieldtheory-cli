import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile, mkdir, utimes, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractGoalNowNext, extractReadmeDescription, scanProjects } from '../src/projects/scan.js';
import { collectSessionPrompts, decodeClaudeProjectRepo } from '../src/projects/sessions.js';
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

// ── Claude Code session prompt extraction ───────────────────────────────

function claudeEncodedPath(repoPath: string): string {
  return repoPath.replace(/\//g, '-');
}

function jsonLine(value: unknown): string {
  return JSON.stringify(value);
}

function userLine(content: unknown, timestamp = '2026-07-06T12:00:00.000Z', extra: Record<string, unknown> = {}): string {
  return jsonLine({
    type: 'user',
    timestamp,
    message: { content },
    ...extra,
  });
}

test('projects: Claude dir-name decoding resolves exact and hyphenated repo paths, and skips unmapped dirs', async () => {
  await withTempDir('ft-projects-decode-', async (scanRoot) => {
    await mkdir(path.join(scanRoot, 'fieldtheory-cli'));
    await mkdir(path.join(scanRoot, 'my-repo'));

    assert.equal(
      decodeClaudeProjectRepo(claudeEncodedPath(path.join(scanRoot, 'fieldtheory-cli')), scanRoot),
      'fieldtheory-cli',
    );
    assert.equal(
      decodeClaudeProjectRepo(claudeEncodedPath(path.join(scanRoot, 'my-repo')), scanRoot),
      'my-repo',
    );
    assert.equal(
      decodeClaudeProjectRepo(claudeEncodedPath(path.join(os.tmpdir(), 'elsewhere')), scanRoot),
      null,
    );
  });
});

test('projects: Claude session line filtering keeps user prompts and skips sidechain/tool/noise/malformed lines', async () => {
  await withTempDir('ft-projects-sessions-', async (root) => {
    const scanRoot = path.join(root, 'Github');
    const claudeRoot = path.join(root, 'claude-projects');
    const repoPath = path.join(scanRoot, 'fieldtheory-cli');
    const sessionDir = path.join(claudeRoot, claudeEncodedPath(repoPath));
    await mkdir(sessionDir, { recursive: true });
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(sessionDir, 'session.jsonl'), [
      userLine('Implement the projects session parser'),
      userLine('Skip sidechain', '2026-07-06T12:01:00.000Z', { isSidechain: true }),
      userLine([{ type: 'tool_result', content: 'ignored' }], '2026-07-06T12:02:00.000Z'),
      userLine('<system-reminder>ignore this</system-reminder>', '2026-07-06T12:03:00.000Z'),
      userLine('<task-notification>\n<task-id>abc</task-id>\n</task-notification>', '2026-07-06T12:03:30.000Z'),
      userLine('Caveat: hook wrapper noise', '2026-07-06T12:04:00.000Z'),
      '{not json',
      '',
    ].join('\n'), 'utf8');

    const result = await collectSessionPrompts({
      scanRoot,
      claudeProjectsRoot: claudeRoot,
      now: new Date('2026-07-07T00:00:00.000Z'),
    });

    assert.equal(result.prompts.length, 1);
    assert.deepEqual(result.prompts[0], {
      agent: 'claude',
      repo: 'fieldtheory-cli',
      timestamp: '2026-07-06T12:00:00.000Z',
      text: 'Implement the projects session parser',
    });
  });
});

test('projects: Claude session retention drops prompts older than retentionDays', async () => {
  await withTempDir('ft-projects-retention-', async (root) => {
    const scanRoot = path.join(root, 'Github');
    const claudeRoot = path.join(root, 'claude-projects');
    const repoPath = path.join(scanRoot, 'fieldtheory-cli');
    const sessionDir = path.join(claudeRoot, claudeEncodedPath(repoPath));
    await mkdir(sessionDir, { recursive: true });
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(sessionDir, 'session.jsonl'), [
      userLine('new prompt', '2026-07-06T12:00:00.000Z'),
      userLine('old prompt', '2026-06-01T12:00:00.000Z'),
    ].join('\n'), 'utf8');

    const result = await collectSessionPrompts({
      scanRoot,
      claudeProjectsRoot: claudeRoot,
      retentionDays: 14,
      now: new Date('2026-07-07T00:00:00.000Z'),
    });

    assert.deepEqual(result.prompts.map((prompt) => prompt.text), ['new prompt']);
  });
});

test('projects: Claude session incremental parsing skips unchanged files without reading content', async () => {
  await withTempDir('ft-projects-incremental-', async (root) => {
    const scanRoot = path.join(root, 'Github');
    const claudeRoot = path.join(root, 'claude-projects');
    const repoPath = path.join(scanRoot, 'fieldtheory-cli');
    const sessionDir = path.join(claudeRoot, claudeEncodedPath(repoPath));
    const sessionFile = path.join(sessionDir, 'session.jsonl');
    await mkdir(sessionDir, { recursive: true });
    await mkdir(repoPath, { recursive: true });
    await writeFile(sessionFile, `${userLine('original prompt')}\n`, 'utf8');
    const info = await stat(sessionFile);
    let reads = 0;

    const result = await collectSessionPrompts({
      scanRoot,
      claudeProjectsRoot: claudeRoot,
      now: new Date('2026-07-07T00:00:00.000Z'),
      previousFileStates: {
        [sessionFile]: { mtimeMs: info.mtimeMs, size: info.size },
      },
      readFileText: async () => {
        reads += 1;
        return `${userLine('mutated prompt')}\n`;
      },
    });

    assert.equal(reads, 0);
    assert.equal(result.prompts.length, 0);
    assert.deepEqual(result.fileStates[sessionFile], { mtimeMs: info.mtimeMs, size: info.size });
  });
});

test('projects: markdown renders recent agent queries, active focus, and prompt activity boost', () => {
  const now = new Date('2026-07-07T00:00:00.000Z');
  const prompted = makeRecord({
    repo: 'prompted',
    lastCommitAt: undefined,
    recentCommits: [],
    recentPrompts: [
      {
        timestamp: '2026-07-06T12:00:00.000Z',
        text: 'Investigate Claude session prompt extraction\nand markdown wiring',
      },
    ],
  });
  const idle = makeRecord({
    repo: 'idle',
    lastCommitAt: undefined,
    recentCommits: [],
    recentPrompts: undefined,
  });

  const projectMarkdown = buildProjectMarkdown(prompted);
  assert.match(projectMarkdown, /## Recent agent queries\n- 2026-07-06 Investigate Claude session prompt extraction and markdown wiring/);

  const activeMarkdown = buildProjectsActiveMarkdown([idle, prompted], { now });
  assert.match(activeMarkdown, /## prompted/);
  assert.match(activeMarkdown, /- Recent focus: Investigate Claude session prompt extraction and markdown wiring/);
  assert.equal(rankActiveProjects([idle, prompted], now)[0].repo, 'prompted');
});
