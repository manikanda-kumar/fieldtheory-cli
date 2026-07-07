import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readFile, writeFile, mkdir, utimes, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { extractGoalNowNext, extractReadmeDescription, normalizeProjectRemoteUrl, scanProjects } from '../src/projects/scan.js';
import {
  collectSessionPrompts,
  decodeClaudeProjectRepo,
  parseAgentMessageLines,
  parseAmpThread,
  parseCodexRollout,
  parseDroidIndex,
  parseCwdHeaderSession,
  parsePiSession,
  repoForCwd,
} from '../src/projects/sessions.js';
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

/** Point every non-Claude session source at a nonexistent dir so tests never
 *  read the real ~/.codex, amp, pi, or droid stores. */
function hermeticSessionRoots(root: string) {
  return {
    codexSessionsRoot: path.join(root, 'no-codex'),
    ampThreadsRoot: path.join(root, 'no-amp'),
    piSessionsRoot: path.join(root, 'no-pi'),
    droidRoot: path.join(root, 'no-droid'),
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

async function createCommittedRepo(repoDir: string, remoteUrl?: string): Promise<void> {
  await mkdir(repoDir);
  await git(repoDir, ['init']);
  await git(repoDir, ['config', 'user.email', 'test@example.com']);
  await git(repoDir, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repoDir, 'README.md'), `# ${path.basename(repoDir)}\n\nFixture repo.\n`, 'utf8');
  await git(repoDir, ['add', 'README.md']);
  await git(repoDir, ['commit', '-m', 'initial commit']);
  if (remoteUrl) await git(repoDir, ['remote', 'add', 'origin', remoteUrl]);
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
        claudeProjectsRoot: path.join(scanRoot, 'no-claude'),
        ...hermeticSessionRoots(scanRoot),
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
      assert.equal(result.records[0].remoteUrl, undefined);
      assert.match(await readFile(projectMdPath, 'utf8'), /## Now\nRunning integration test/);
      assert.match(await readFile(activeMdPath, 'utf8'), /## tiny-repo/);
    });
  });
});

test('projects: normalizes GitHub remote URLs and preserves non-GitHub remotes', async (t) => {
  if (!(await gitAvailable())) {
    t.skip('git is unavailable');
    return;
  }

  assert.equal(normalizeProjectRemoteUrl('git@github.com:owner/repo.git\n'), 'https://github.com/owner/repo');
  assert.equal(normalizeProjectRemoteUrl('https://github.com/owner/repo.git'), 'https://github.com/owner/repo');
  assert.equal(normalizeProjectRemoteUrl('ssh://git@example.com/owner/repo.git'), 'ssh://git@example.com/owner/repo.git');

  await withTempDir('ft-projects-remotes-', async (scanRoot) => {
    await createCommittedRepo(path.join(scanRoot, 'ssh-github'), 'git@github.com:owner/ssh-github.git');
    await createCommittedRepo(path.join(scanRoot, 'https-github'), 'https://github.com/owner/https-github.git');
    await createCommittedRepo(path.join(scanRoot, 'elsewhere'), 'ssh://git@example.com/owner/elsewhere.git');
    await createCommittedRepo(path.join(scanRoot, 'missing'));

    const result = await scanProjects({
      scanRoot,
      now: new Date('2026-07-07T00:00:00.000Z'),
      gitTimeoutMs: 5000,
    });
    const byRepo = new Map(result.records.map((record) => [record.repo, record]));

    assert.equal(byRepo.get('ssh-github')?.remoteUrl, 'https://github.com/owner/ssh-github');
    assert.equal(byRepo.get('https-github')?.remoteUrl, 'https://github.com/owner/https-github');
    assert.equal(byRepo.get('elsewhere')?.remoteUrl, 'ssh://git@example.com/owner/elsewhere.git');
    assert.equal(byRepo.get('missing')?.remoteUrl, undefined);
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
      userLine('This session is being continued from a previous conversation that ran out of context. Summary: ...', '2026-07-06T12:04:30.000Z'),
      '{not json',
      '',
    ].join('\n'), 'utf8');

    const result = await collectSessionPrompts({
      scanRoot,
      claudeProjectsRoot: claudeRoot,
      ...hermeticSessionRoots(root),
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
      ...hermeticSessionRoots(root),
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
      ...hermeticSessionRoots(root),
      now: new Date('2026-07-07T00:00:00.000Z'),
      previousFileStates: {
        [sessionFile]: { mtimeMs: info.mtimeMs, size: info.size },
      },
      readFileText: async (filePath: string) => {
        if (filePath.endsWith('sessions-index.json')) throw new Error('absent');
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

// ── Codex / Amp / Pi / Droid session parsing ─────────────────────────────

const SESSION_CUTOFF = Date.parse('2026-06-25T00:00:00.000Z');

test('projects: parseCodexRollout maps cwd to repo and keeps only real user prompts', () => {
  const raw = [
    JSON.stringify({ timestamp: '2026-07-06T10:00:00.000Z', type: 'session_meta', payload: { cwd: '/Users/x/Github/my-repo/sub' } }),
    JSON.stringify({ timestamp: '2026-07-06T10:01:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions\nboilerplate' }] } }),
    JSON.stringify({ timestamp: '2026-07-06T10:02:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>stuff</environment_context>' }] } }),
    JSON.stringify({ timestamp: '2026-07-06T10:03:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the flaky retry logic' }] } }),
    JSON.stringify({ timestamp: '2026-06-01T10:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'too old to keep' }] } }),
  ].join('\n');

  const prompts = parseCodexRollout(raw, '/Users/x/Github', '2026-07-06T00:00:00.000Z', SESSION_CUTOFF);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].agent, 'codex');
  assert.equal(prompts[0].repo, 'my-repo');
  assert.equal(prompts[0].text, 'fix the flaky retry logic');
});

test('projects: parseCodexRollout returns nothing when cwd is outside the scan root', () => {
  const raw = [
    JSON.stringify({ type: 'session_meta', payload: { cwd: '/tmp/elsewhere' } }),
    JSON.stringify({ timestamp: '2026-07-06T10:03:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'question' }] } }),
  ].join('\n');
  assert.deepEqual(parseCodexRollout(raw, '/Users/x/Github', '2026-07-06T00:00:00.000Z', SESSION_CUTOFF), []);
});

test('projects: parseAmpThread reads repo from env trees and stamps thread created time', () => {
  const raw = JSON.stringify({
    created: Date.parse('2026-07-05T09:00:00.000Z'),
    env: { initial: { trees: [{ uri: 'file:///Users/x/Github/tools' }] } },
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'why does the trace parser stall?' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'because...' }] },
      { role: 'user', content: [{ type: 'text', text: '<system-reminder>noise</system-reminder>' }] },
    ],
  });

  const prompts = parseAmpThread(raw, '/Users/x/Github', '2026-07-05T00:00:00.000Z', SESSION_CUTOFF);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].agent, 'amp');
  assert.equal(prompts[0].repo, 'tools');
  assert.equal(prompts[0].timestamp, '2026-07-05T09:00:00.000Z');
});

test('projects: parseAmpThread drops whole thread when older than retention or outside root', () => {
  const old = JSON.stringify({
    created: Date.parse('2026-01-01T00:00:00.000Z'),
    env: { initial: { trees: [{ uri: 'file:///Users/x/Github/tools' }] } },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'ancient' }] }],
  });
  assert.deepEqual(parseAmpThread(old, '/Users/x/Github', '2026-07-05T00:00:00.000Z', SESSION_CUTOFF), []);

  const foreign = JSON.stringify({
    created: Date.parse('2026-07-05T00:00:00.000Z'),
    env: { initial: { trees: [{ uri: 'file:///opt/elsewhere' }] } },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  });
  assert.deepEqual(parseAmpThread(foreign, '/Users/x/Github', '2026-07-05T00:00:00.000Z', SESSION_CUTOFF), []);
});

test('projects: parsePiSession reads cwd from the session header line', () => {
  const raw = [
    JSON.stringify({ type: 'session', version: 3, timestamp: '2026-07-04T11:20:56.401Z', cwd: '/Users/x/Github/summarize' }),
    JSON.stringify({ type: 'model_change', timestamp: '2026-07-04T11:21:00.470Z' }),
    JSON.stringify({ type: 'message', timestamp: '2026-07-04T11:21:58.606Z', message: { role: 'user', content: [{ type: 'text', text: 'does summarize support opencode models?' }] } }),
  ].join('\n');

  const prompts = parsePiSession(raw, '/Users/x/Github', '2026-07-04T00:00:00.000Z', SESSION_CUTOFF);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].agent, 'pi');
  assert.equal(prompts[0].repo, 'summarize');
});

test('projects: parseDroidIndex + parseAgentMessageLines cover the droid layout', () => {
  const index = parseDroidIndex(JSON.stringify({
    version: 2,
    entries: [
      { sessionId: 'abc', cwd: '/Users/x/Github/omnigent', mtime: Date.parse('2026-07-06T00:00:00.000Z') },
      { sessionId: 'broken' },
    ],
  }));
  assert.equal(index.length, 2);
  assert.equal(index[0].cwd, '/Users/x/Github/omnigent');

  const raw = [
    JSON.stringify({ type: 'session_start', id: 'abc', title: 't' }),
    JSON.stringify({ type: 'message', timestamp: '2026-07-06T02:45:00.000Z', message: { role: 'user', content: [{ type: 'text', text: '<system-reminder>env dump</system-reminder>' }] } }),
    JSON.stringify({ type: 'message', timestamp: '2026-07-06T02:46:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'add retry to the uploader' }] } }),
  ].join('\n');
  const prompts = parseAgentMessageLines(raw, 'droid', 'omnigent', '2026-07-06T00:00:00.000Z', SESSION_CUTOFF);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].agent, 'droid');
  assert.equal(prompts[0].text, 'add retry to the uploader');
});

test('projects: repoForCwd maps subdirectories to their depth-1 repo', () => {
  assert.equal(repoForCwd('/Users/x/Github/my-repo/deep/sub', '/Users/x/Github'), 'my-repo');
  assert.equal(repoForCwd('/Users/x/Github', '/Users/x/Github'), null);
  assert.equal(repoForCwd('/opt/other', '/Users/x/Github'), null);
});

test('projects: collectSessionPrompts merges codex, amp, pi, and droid sources', async () => {
  await withTempDir('ft-projects-multi-', async (root) => {
    const scanRoot = path.join(root, 'Github');
    await mkdir(path.join(scanRoot, 'my-repo'), { recursive: true });

    const codexRoot = path.join(root, 'codex');
    await mkdir(path.join(codexRoot, '2026', '07', '06'), { recursive: true });
    await writeFile(path.join(codexRoot, '2026', '07', '06', 'rollout-1.jsonl'), [
      JSON.stringify({ type: 'session_meta', payload: { cwd: path.join(scanRoot, 'my-repo') } }),
      JSON.stringify({ timestamp: '2026-07-06T10:00:00.000Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'codex question' }] } }),
    ].join('\n'), 'utf8');

    const ampRoot = path.join(root, 'amp');
    await mkdir(ampRoot, { recursive: true });
    await writeFile(path.join(ampRoot, 'T-1.json'), JSON.stringify({
      created: Date.parse('2026-07-06T11:00:00.000Z'),
      env: { initial: { trees: [{ uri: `file://${path.join(scanRoot, 'my-repo')}` }] } },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'amp question' }] }],
    }), 'utf8');

    const piRoot = path.join(root, 'pi');
    await mkdir(path.join(piRoot, 'enc'), { recursive: true });
    await writeFile(path.join(piRoot, 'enc', 's1.jsonl'), [
      JSON.stringify({ type: 'session', cwd: path.join(scanRoot, 'my-repo') }),
      JSON.stringify({ type: 'message', timestamp: '2026-07-06T12:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'pi question' }] } }),
    ].join('\n'), 'utf8');

    const droidRoot = path.join(root, 'droid');
    await mkdir(path.join(droidRoot, 'sessions'), { recursive: true });
    await writeFile(path.join(droidRoot, 'sessions-index.json'), JSON.stringify({
      version: 2,
      entries: [{ sessionId: 's9', cwd: path.join(scanRoot, 'my-repo'), mtime: Date.parse('2026-07-06T13:00:00.000Z') }],
    }), 'utf8');
    await writeFile(path.join(droidRoot, 'sessions', 's9.jsonl'), [
      JSON.stringify({ type: 'message', timestamp: '2026-07-06T13:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'droid question' }] } }),
    ].join('\n'), 'utf8');

    const result = await collectSessionPrompts({
      scanRoot,
      claudeProjectsRoot: path.join(root, 'no-claude'),
      codexSessionsRoot: codexRoot,
      ampThreadsRoot: ampRoot,
      piSessionsRoot: piRoot,
      droidRoot,
      now: new Date('2026-07-07T00:00:00.000Z'),
    });

    const byAgent = new Map(result.prompts.map((prompt) => [prompt.agent, prompt.text]));
    assert.equal(result.prompts.length, 4);
    assert.equal(byAgent.get('codex'), 'codex question');
    assert.equal(byAgent.get('amp'), 'amp question');
    assert.equal(byAgent.get('pi'), 'pi question');
    assert.equal(byAgent.get('droid'), 'droid question');
    assert.ok(result.prompts.every((prompt) => prompt.repo === 'my-repo'));
  });
});

test('projects: droid subdir layout parses cwd from session_start header and filters env-dump blocks', () => {
  const raw = [
    JSON.stringify({ type: 'session_start', id: 'x', title: 't', cwd: '/Users/x/Github/openrouter-cli' }),
    JSON.stringify({ type: 'message', timestamp: '2026-07-06T02:45:00.000Z', message: { role: 'user', content: [
      { type: 'text', text: '<system-reminder>env dump</system-reminder>' },
      { type: 'text', text: 'review the plan and suggest improvements' },
    ] } }),
  ].join('\n');

  const prompts = parseCwdHeaderSession(raw, 'droid', ['session_start'], '/Users/x/Github', '2026-07-06T00:00:00.000Z', SESSION_CUTOFF);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].repo, 'openrouter-cli');
  assert.equal(prompts[0].text, 'review the plan and suggest improvements');
});
