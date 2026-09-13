/**
 * Local projects sync orchestration: scan depth-1 git repos, write JSONL/meta,
 * and emit deterministic markdown for agent-readable work context.
 */

import { pathExists, readJson, readJsonLines, writeJson, writeJsonLines } from '../fs.js';
import { scanProjects } from './scan.js';
import { collectSessionPrompts } from './sessions.js';
import { collectAmpCloudActivity, mapAmpActivityToProjects } from './amp-cloud.js';
import { emitProjectsMarkdown } from './markdown.js';
import { ensureProjectsDir, ensureProjectsLibraryDir, projectsCachePath, projectsMetaPath, projectsLibraryDir } from './paths.js';
import type { AmpThreadActivity, ProjectRecord, ProjectSyncOptions, ProjectSyncResult, ProjectsMeta, SessionPrompt } from './types.js';

export interface ProjectsStatusView {
  count: number;
  withPrompts: number;
  withAgentActivity: number;
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

function recentActivityForRepo(
  current: AmpThreadActivity[],
  previous: ProjectRecord | undefined,
  cutoffMs: number,
): AmpThreadActivity[] | undefined {
  const byId = new Map<string, AmpThreadActivity>();
  for (const item of [...(previous?.recentAgentActivity ?? []), ...current]) {
    if ((Date.parse(item.updatedAt) || 0) < cutoffMs) continue;
    const existing = byId.get(item.threadId);
    if (!existing || Date.parse(item.updatedAt) > Date.parse(existing.updatedAt)) byId.set(item.threadId, item);
  }
  const sorted = [...byId.values()]
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 10);
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
  const ampCloudCollection = options.noSessions
    ? null
    : await collectAmpCloudActivity({
      command: options.agentSessionsCli,
      retentionDays: sessionRetentionDays,
      now,
    });
  const mappedAmp = ampCloudCollection
    ? mapAmpActivityToProjects(scanResult.records, ampCloudCollection.activity)
    : { byRepo: new Map<string, AmpThreadActivity[]>(), matched: 0, unmatched: 0 };
  const records = sortedForCache(scanResult.records.map((record) => ({
    ...record,
    recentPrompts: options.noSessions
      ? undefined
      : recentPromptsForRepo(record.repo, sessionResult.prompts, previousRecords.get(record.repo), sessionCutoffMs),
    recentAgentActivity: options.noSessions
      ? undefined
      : recentActivityForRepo(mappedAmp.byRepo.get(record.repo) ?? [], previousRecords.get(record.repo), sessionCutoffMs),
  })));

  await writeJsonLines(cachePath, records);

  const meta: ProjectsMeta = {
    lastSyncedAt: scanResult.scannedAt,
    scanRoot: scanResult.scanRoot,
    repoCount: records.length,
    errors: scanResult.errors,
    ...(sessionResult.fileStates ? { sessionFiles: sessionResult.fileStates } : {}),
    ...(ampCloudCollection ? {
      ampCloud: {
        available: ampCloudCollection.available,
        attemptedAt: ampCloudCollection.attemptedAt,
        listed: ampCloudCollection.listed,
        fetched: ampCloudCollection.fetched,
        unchanged: ampCloudCollection.unchanged,
        deferred: ampCloudCollection.deferred,
        exportErrors: ampCloudCollection.exportErrors,
        matched: mappedAmp.matched,
        unmatched: mappedAmp.unmatched,
        ...(ampCloudCollection.error ? { error: ampCloudCollection.error } : {}),
      },
    } : {}),
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
    ampCloud: meta.ampCloud,
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
  const withAgentActivity = records.filter((record) => (record.recentAgentActivity?.length ?? 0) > 0).length;
  return { count, withPrompts, withAgentActivity, lastSyncedAt, cachePath };
}
