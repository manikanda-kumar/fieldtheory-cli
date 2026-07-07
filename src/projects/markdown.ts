import { writeMd } from '../fs.js';
import { projectMarkdownPath, projectsActiveMarkdownPath, projectsLibraryDir } from './paths.js';
import type { ProjectCommit, ProjectRecord } from './types.js';

function escapeYaml(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function yamlQuoted(value: string): string {
  return `"${escapeYaml(value)}"`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  const normalized = oneLine(value);
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max).trimEnd();
}

function firstLines(value: string | undefined, count: number): string | undefined {
  if (!value) return undefined;
  const lines = value.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, count);
  return lines.length ? lines.join(' / ') : undefined;
}

function dateOnly(value: string | undefined): string {
  return value ? value.slice(0, 10) : 'unknown';
}

function commitSubjectLine(commit: ProjectCommit): string {
  return `- ${dateOnly(commit.date)} ${commit.subject}`;
}

function promptLine(prompt: { timestamp: string; text: string }): string {
  return `- ${dateOnly(prompt.timestamp)} ${truncate(prompt.text, 200)}`;
}

export function buildProjectMarkdown(record: ProjectRecord): string {
  const lines: string[] = [];

  lines.push('---');
  lines.push(`repo: ${yamlQuoted(record.repo)}`);
  lines.push(`path: ${yamlQuoted(record.path)}`);
  if (record.lastCommitAt) lines.push(`last_commit_at: ${yamlQuoted(record.lastCommitAt)}`);
  lines.push(`pending: ${record.pendingFiles}`);
  lines.push(`unpushed: ${record.unpushedCommits}`);
  lines.push(`updated_at: ${yamlQuoted(record.scannedAt)}`);
  lines.push('---');
  lines.push('');

  lines.push(`# ${record.repo}`);
  lines.push('');

  if (record.description) {
    lines.push(record.description);
    lines.push('');
  }

  if (record.goalNowNext?.goal) {
    lines.push('## Goal');
    lines.push(record.goalNowNext.goal);
    lines.push('');
  }

  if (record.goalNowNext?.now) {
    lines.push('## Now');
    lines.push(record.goalNowNext.now);
    lines.push('');
  }

  if (record.goalNowNext?.next) {
    lines.push('## Next');
    lines.push(record.goalNowNext.next);
    lines.push('');
  }

  if (record.recentCommits.length > 0) {
    lines.push('## Recent commits');
    for (const commit of record.recentCommits) lines.push(commitSubjectLine(commit));
    lines.push('');
  }

  if (record.recentPrompts && record.recentPrompts.length > 0) {
    lines.push('## Recent agent queries');
    for (const prompt of record.recentPrompts) lines.push(promptLine(prompt));
    lines.push('');
  }

  return lines.join('\n');
}

function activityScore(record: ProjectRecord, now: Date): number {
  const nowMs = now.getTime();
  let score = 0;

  for (const commit of record.recentCommits) {
    const commitMs = Date.parse(commit.date);
    if (!Number.isFinite(commitMs)) continue;
    const ageDays = Math.max(0, (nowMs - commitMs) / (24 * 60 * 60 * 1000));
    score += Math.exp(-ageDays / 7);
  }

  for (const prompt of record.recentPrompts ?? []) {
    const promptMs = Date.parse(prompt.timestamp);
    if (!Number.isFinite(promptMs)) continue;
    const ageDays = Math.max(0, (nowMs - promptMs) / (24 * 60 * 60 * 1000));
    score += 0.5 * Math.exp(-ageDays / 7);
  }

  score += Math.min(record.pendingFiles, 20) * 0.05;
  score += Math.min(record.unpushedCommits, 20) * 0.1;
  return score;
}

function lastTouchedMs(record: ProjectRecord): number {
  const candidates = [
    record.lastCommitAt,
    ...record.recentCommits.map((commit) => commit.date),
  ].map((value) => Date.parse(value ?? '') || 0);
  return Math.max(0, ...candidates);
}

export function rankActiveProjects(records: ProjectRecord[], now: Date): ProjectRecord[] {
  return [...records].sort((a, b) => {
    const scoreDelta = activityScore(b, now) - activityScore(a, now);
    if (Math.abs(scoreDelta) > 0.000001) return scoreDelta;
    const touchedDelta = lastTouchedMs(b) - lastTouchedMs(a);
    if (touchedDelta !== 0) return touchedDelta;
    return a.repo.localeCompare(b.repo);
  });
}

function blockForProject(record: ProjectRecord): string[] {
  const lines: string[] = [];
  lines.push(`## ${record.repo}`);
  if (record.description) lines.push(oneLine(record.description));
  const now = firstLines(record.goalNowNext?.now, 2);
  const next = firstLines(record.goalNowNext?.next, 2);
  if (now) lines.push(`- Now: ${now}`);
  if (next) lines.push(`- Next: ${next}`);
  if (record.recentPrompts?.[0]) lines.push(`- Recent focus: ${truncate(record.recentPrompts[0].text, 120)}`);
  lines.push(`- Last touched: ${dateOnly(record.lastCommitAt)}`);
  lines.push('');
  return lines;
}

export function buildProjectsActiveMarkdown(records: ProjectRecord[], options: { now?: Date; maxLines?: number; limit?: number } = {}): string {
  const now = options.now ?? new Date();
  const maxLines = options.maxLines ?? 120;
  const limit = options.limit ?? 10;
  const lines: string[] = [
    '# Active Projects',
    '',
  ];

  for (const record of rankActiveProjects(records, now).slice(0, limit)) {
    const block = blockForProject(record);
    if (lines.length + block.length > maxLines) break;
    lines.push(...block);
  }

  return lines.slice(0, maxLines).join('\n');
}

export async function emitProjectsMarkdown(records: ProjectRecord[], now: Date = new Date()): Promise<{ projectFiles: string[]; activePath: string }> {
  const projectFiles: string[] = [];
  projectsLibraryDir();

  for (const record of records) {
    const filePath = projectMarkdownPath(record.repo);
    await writeMd(filePath, buildProjectMarkdown(record));
    projectFiles.push(filePath);
  }

  const activePath = projectsActiveMarkdownPath();
  await writeMd(activePath, buildProjectsActiveMarkdown(records, { now }));
  return { projectFiles, activePath };
}
