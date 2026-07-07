/**
 * Local projects sync orchestration: scan depth-1 git repos, write JSONL/meta,
 * and emit deterministic markdown for agent-readable work context.
 */

import { pathExists, readJson, readJsonLines, writeJson, writeJsonLines } from '../fs.js';
import { scanProjects } from './scan.js';
import { collectSessionPrompts } from './sessions.js';
import { emitProjectsMarkdown } from './markdown.js';
import { ensureProjectsDir, ensureProjectsLibraryDir, projectsCachePath, projectsMetaPath, projectsLibraryDir } from './paths.js';
import type { ProjectRecord, ProjectSyncOptions, ProjectSyncResult, ProjectsMeta, SessionPrompt } from './types.js';

export interface ProjectsStatusView {
  count: number;
  withPrompts: number;
  lastSyncedAt: string | null;
  cachePath: string;
}

function sortedForCache(records: ProjectRecord[]): ProjectRecord[] {
  return [...records].sort((a, b) => {
    const byCommit = (Date.parse(b.lastCommitAt ?? '') || 0) - (Date.parse(a.lastCommitAt ?? '') || 0);
    if (byCommit !== 0) return byCommit;
    return a.repo.localeCompare(b.repo);
  });
}

function promptKey(prompt: { timestamp: string; text: string }): string {
  return `${prompt.timestamp}\n${prompt.text}`;
}

function recentPromptsForRepo(
  repo: string,
  prompts: SessionPrompt[],
  previous: ProjectRecord | undefined,
  cutoffMs: number,
): { timestamp: string; text: string }[] | undefined {
  const byKey = new Map<string, { timestamp: string; text: string }>();

  for (const prompt of previous?.recentPrompts ?? []) {
    if ((Date.parse(prompt.timestamp) || 0) < cutoffMs) continue;
    byKey.set(promptKey(prompt), prompt);
  }
  for (const prompt of prompts) {
    if (prompt.repo === repo) {
      const value = { timestamp: prompt.timestamp, text: prompt.text };
      byKey.set(promptKey(value), value);
    }
  }

  const sorted = [...byKey.values()].sort((a, b) => {
    const byTime = (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0);
    if (byTime !== 0) return byTime;
    return a.text.localeCompare(b.text);
  }).slice(0, 50);

  return sorted.length ? sorted : undefined;
}

async function readPreviousMeta(metaPath: string): Promise<ProjectsMeta | undefined> {
  if (!(await pathExists(metaPath))) return undefined;
  try {
    return await readJson<ProjectsMeta>(metaPath);
  } catch {
    return undefined;
  }
}

async function readPreviousRecords(cachePath: string): Promise<Map<string, ProjectRecord>> {
  const records = await readJsonLines<ProjectRecord>(cachePath);
  return new Map(records.map((record) => [record.repo, record]));
}

export async function syncProjects(options: ProjectSyncOptions = {}): Promise<ProjectSyncResult> {
  ensureProjectsDir();
  ensureProjectsLibraryDir();

  const now = options.now ?? new Date();
  const sessionRetentionDays = options.sessionRetentionDays ?? 14;
  const sessionCutoffMs = now.getTime() - sessionRetentionDays * 24 * 60 * 60 * 1000;
  const scanResult = await scanProjects({ ...options, now });
  const cachePath = projectsCachePath();
  const metaPath = projectsMetaPath();
  const previousMeta = await readPreviousMeta(metaPath);
  const previousRecords = await readPreviousRecords(cachePath);
  const sessionResult = options.noSessions
    ? { prompts: [], fileStates: previousMeta?.sessionFiles }
    : await collectSessionPrompts({
      scanRoot: scanResult.scanRoot,
      claudeProjectsRoot: options.claudeProjectsRoot,
      codexSessionsRoot: options.codexSessionsRoot,
      ampThreadsRoot: options.ampThreadsRoot,
      piSessionsRoot: options.piSessionsRoot,
      droidRoot: options.droidRoot,
      retentionDays: sessionRetentionDays,
      now,
      previousFileStates: previousMeta?.sessionFiles,
    });
  const records = sortedForCache(scanResult.records.map((record) => ({
    ...record,
    recentPrompts: options.noSessions
      ? undefined
      : recentPromptsForRepo(record.repo, sessionResult.prompts, previousRecords.get(record.repo), sessionCutoffMs),
  })));

  await writeJsonLines(cachePath, records);

  const meta: ProjectsMeta = {
    lastSyncedAt: scanResult.scannedAt,
    scanRoot: scanResult.scanRoot,
    repoCount: records.length,
    errors: scanResult.errors,
    ...(sessionResult.fileStates ? { sessionFiles: sessionResult.fileStates } : {}),
  };
  await writeJson(metaPath, meta);

  const mdResult = await emitProjectsMarkdown(records, now);

  return {
    records,
    errors: scanResult.errors,
    cachePath,
    metaPath,
    libraryDir: projectsLibraryDir(),
    activePath: mdResult.activePath,
  };
}

export async function getProjectsStatus(): Promise<ProjectsStatusView | null> {
  const cachePath = projectsCachePath();
  const metaPath = projectsMetaPath();
  if (!(await pathExists(cachePath)) && !(await pathExists(metaPath))) return null;

  let lastSyncedAt: string | null = null;
  let count = 0;
  try {
    const meta = await readJson<ProjectsMeta>(metaPath);
    lastSyncedAt = meta.lastSyncedAt ?? null;
    count = meta.repoCount ?? 0;
  } catch {
    // Cache can still provide counts when meta is absent or malformed.
  }

  const records = await readJsonLines<ProjectRecord>(cachePath);
  if (records.length > 0) count = records.length;
  const withPrompts = records.filter((record) => (record.recentPrompts?.length ?? 0) > 0).length;
  return { count, withPrompts, lastSyncedAt, cachePath };
}
