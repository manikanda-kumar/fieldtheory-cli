import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type {
  ProjectCommit,
  ProjectGoalNowNext,
  ProjectRecord,
  ProjectScanError,
  ProjectScanOptions,
  ProjectScanResult,
} from './types.js';

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_AGE_DAYS = 90;
const DEFAULT_GIT_TIMEOUT_MS = 5000;
const RECENT_COMMIT_LIMIT = 30;

interface GitResult {
  stdout: string;
  stderr: string;
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function capChars(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max).trimEnd();
}

function isBadgeImageLine(line: string): boolean {
  const trimmed = line.trim();
  return /^\[!\[[^\]]*\]\([^)]+\)\]\([^)]+\)$/.test(trimmed) || /^!\[[^\]]*\]\([^)]+\)$/.test(trimmed);
}

export function extractReadmeDescription(markdown: string, maxChars = 400): string | undefined {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const paragraphs = normalized.split(/\n\s*\n/);

  for (const paragraph of paragraphs) {
    const lines = paragraph
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('#'))
      .filter((line) => !line.startsWith('<'))
      .filter((line) => !isBadgeImageLine(line));

    const text = lines.join(' ').replace(/\s+/g, ' ').trim();
    if (text) return capChars(text, maxChars);
  }

  return undefined;
}

function normalizeSectionKey(value: string): keyof ProjectGoalNowNext | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('goal')) return 'goal';
  if (normalized === 'now') return 'now';
  if (normalized === 'next') return 'next';
  return null;
}

function targetBulletHeading(line: string): { key: keyof ProjectGoalNowNext; rest: string } | null {
  const match = line.match(/^-?\s*\*{0,2}(Goal(?:\s*\([^)]*\))?|Now|Next)\*{0,2}\s*:\s*\*{0,2}\s*(.*)$/i);
  const key = match ? normalizeSectionKey(match[1]) : null;
  return match && key ? { key, rest: match[2] ?? '' } : null;
}

const LEDGER_SIBLING_LABELS = /^-?\s*\*{0,2}(Constraints|Key decisions|State|Done|Open questions|Working set|Project learnings)\b[^:\n]*:/i;

function targetMarkdownHeading(line: string): keyof ProjectGoalNowNext | null {
  const match = line.match(/^#{1,6}\s+(Goal|Now|Next)\b.*$/i);
  return match ? normalizeSectionKey(match[1]) : null;
}

function isAnyBulletLabel(line: string): boolean {
  return /^-\s+\*{0,2}[A-Za-z][^:\n]{0,80}:\s*/.test(line);
}

function trimCaptured(lines: string[]): string | undefined {
  const start = lines.findIndex((line) => line.trim() !== '');
  if (start === -1) return undefined;
  let end = lines.length;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end).join('\n').trimEnd();
}

export function extractGoalNowNext(markdown: string, maxLinesPerSection = 40): ProjectGoalNowNext | undefined {
  const sections: Record<keyof ProjectGoalNowNext, string[]> = { goal: [], now: [], next: [] };
  let current: keyof ProjectGoalNowNext | null = null;
  let mode: 'bullet' | 'markdown' | null = null;

  for (const rawLine of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const markdownHeading = targetMarkdownHeading(rawLine);
    if (markdownHeading) {
      current = markdownHeading;
      mode = 'markdown';
      continue;
    }

    const bulletHeading = targetBulletHeading(rawLine);
    if (bulletHeading) {
      current = bulletHeading.key;
      mode = 'bullet';
      if (bulletHeading.rest.trim() && sections[current].length < maxLinesPerSection) {
        sections[current].push(bulletHeading.rest.trimEnd());
      }
      continue;
    }

    if (!current) continue;
    if (mode === 'markdown' && /^#{1,6}\s+/.test(rawLine)) {
      current = null;
      mode = null;
      continue;
    }
    if (mode === 'bullet' && (isAnyBulletLabel(rawLine) || LEDGER_SIBLING_LABELS.test(rawLine) || /^[A-Za-z][^:\n]{0,80}:\s*$/.test(rawLine))) {
      current = null;
      mode = null;
      continue;
    }
    if (sections[current].length < maxLinesPerSection) {
      sections[current].push(rawLine);
    }
  }

  const result: ProjectGoalNowNext = {};
  const goal = trimCaptured(sections.goal);
  const now = trimCaptured(sections.now);
  const next = trimCaptured(sections.next);
  if (goal) result.goal = goal;
  if (now) result.now = now;
  if (next) result.next = next;

  return result.goal || result.now || result.next ? result : undefined;
}

function parseGitLog(stdout: string): ProjectCommit[] {
  return stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, RECENT_COMMIT_LIMIT)
    .map((line) => {
      const parts = line.split('|');
      return {
        hash: parts[0] ?? '',
        date: parts[1] ?? '',
        subject: parts.slice(2).join('|'),
      };
    })
    .filter((commit) => commit.hash && commit.date);
}

function parsePendingFiles(stdout: string): number {
  return stdout.split('\n').filter((line) => line.trim() !== '').length;
}

export function normalizeProjectRemoteUrl(value: string): string {
  const trimmed = value.trim();
  const sshMatch = trimmed.match(/^git@github\.com:([^/\s]+)\/(.+?)(?:\.git)?$/i);
  if (sshMatch) return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;

  try {
    const url = new URL(trimmed);
    if (url.protocol === 'https:' && url.hostname.toLowerCase() === 'github.com') {
      const parts = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/');
      if (parts.length >= 2 && parts[0] && parts[1]) {
        const repo = parts[1].replace(/\.git$/i, '');
        return `https://github.com/${parts[0]}/${repo}`;
      }
    }
  } catch {
    // Non-URL remotes are preserved as-is below.
  }

  return trimmed;
}

async function runGit(repoPath: string, args: string[], timeout: number): Promise<GitResult> {
  const result = await execFileAsync('git', args, {
    cwd: repoPath,
    timeout,
    maxBuffer: 1024 * 1024,
  });
  return {
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}

async function readOptionalFile(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

async function newestGitStateMtime(repoPath: string): Promise<number | null> {
  const candidates = [path.join(repoPath, '.git', 'HEAD'), path.join(repoPath, '.git', 'index')];
  const mtimes: number[] = [];

  for (const candidate of candidates) {
    try {
      const info = await stat(candidate);
      mtimes.push(info.mtimeMs);
    } catch {
      // Some newly initialized repos may not have an index yet.
    }
  }

  return mtimes.length > 0 ? Math.max(...mtimes) : null;
}

async function isGitDir(repoPath: string): Promise<boolean> {
  try {
    const info = await stat(path.join(repoPath, '.git'));
    return info.isDirectory();
  } catch {
    return false;
  }
}

async function scanRepo(
  repoPath: string,
  repo: string,
  scannedAt: string,
  gitTimeoutMs: number,
  errors: ProjectScanError[],
): Promise<ProjectRecord | null> {
  const recentCommits = await runGit(repoPath, ['log', '--since=14.days', '--format=%H|%aI|%s', '-n', String(RECENT_COMMIT_LIMIT)], gitTimeoutMs)
    .then((result) => parseGitLog(result.stdout))
    .catch((error) => {
      errors.push({ repo, path: repoPath, stage: 'git log', message: messageFromError(error) });
      return [];
    });

  const pendingFiles = await runGit(repoPath, ['status', '--porcelain'], gitTimeoutMs)
    .then((result) => parsePendingFiles(result.stdout))
    .catch((error) => {
      errors.push({ repo, path: repoPath, stage: 'git status', message: messageFromError(error) });
      return 0;
    });

  const unpushedCommits = await runGit(repoPath, ['rev-list', '@{u}..HEAD', '--count'], gitTimeoutMs)
    .then((result) => Number.parseInt(result.stdout.trim(), 10) || 0)
    .catch(() => 0);

  const remoteUrl = await runGit(repoPath, ['remote', 'get-url', 'origin'], gitTimeoutMs)
    .then((result) => normalizeProjectRemoteUrl(result.stdout))
    .catch(() => undefined);

  const continuity = await readOptionalFile(path.join(repoPath, 'CONTINUITY.md'));
  const readme = await readOptionalFile(path.join(repoPath, 'README.md'));
  const goalNowNext = continuity ? extractGoalNowNext(continuity) : undefined;
  const description = readme ? extractReadmeDescription(readme) : undefined;

  return {
    repo,
    path: repoPath,
    remoteUrl,
    description,
    goalNowNext,
    lastCommitAt: recentCommits[0]?.date,
    pendingFiles,
    unpushedCommits,
    recentCommits,
    scannedAt,
  };
}

function sortRecords(records: ProjectRecord[]): ProjectRecord[] {
  return [...records].sort((a, b) => {
    const byCommit = (Date.parse(b.lastCommitAt ?? '') || 0) - (Date.parse(a.lastCommitAt ?? '') || 0);
    if (byCommit !== 0) return byCommit;
    return a.repo.localeCompare(b.repo);
  });
}

export async function scanProjects(options: ProjectScanOptions = {}): Promise<ProjectScanResult> {
  const scanRoot = options.scanRoot ?? path.join(os.homedir(), 'Github');
  const now = options.now ?? new Date();
  const scannedAt = now.toISOString();
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const gitTimeoutMs = options.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
  const cutoffMs = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  const errors: ProjectScanError[] = [];
  const records: ProjectRecord[] = [];

  let entries;
  try {
    entries = await readdir(scanRoot, { withFileTypes: true });
  } catch (error) {
    errors.push({ repo: path.basename(scanRoot), path: scanRoot, stage: 'scan root', message: messageFromError(error) });
    return { records, errors, scanRoot, scannedAt };
  }

  const dirs = entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of dirs) {
    const repo = entry.name;
    const repoPath = path.join(scanRoot, repo);
    if (!(await isGitDir(repoPath))) continue;

    const stateMtime = await newestGitStateMtime(repoPath);
    if (stateMtime == null || stateMtime < cutoffMs) continue;

    const record = await scanRepo(repoPath, repo, scannedAt, gitTimeoutMs, errors);
    if (record) records.push(record);
  }

  return { records: sortRecords(records), errors, scanRoot, scannedAt };
}
