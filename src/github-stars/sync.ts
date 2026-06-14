import { mkdir } from 'node:fs/promises';
import { pathExists, readJson, readJsonLines, writeJson, writeJsonLines } from '../fs.js';
import { fetchGitHubStars, type GitHubStarsClientOptions } from './client.js';
import { githubStarsCachePath, githubStarsDir, githubStarsMetaPath } from './paths.js';
import type { GitHubStarRecord, GitHubStarsMeta } from './types.js';

export interface SyncGitHubStarsOptions extends GitHubStarsClientOptions {
  rebuild?: boolean;
  dryRun?: boolean;
  limit?: number;
}

export interface SyncGitHubStarsResult {
  fetched: number;
  added: number;
  updated: number;
  skipped: number;
  total: number;
  newestStarredAt: string | null;
  cachePath: string;
}

function materialGitHubStarChanged(existing: GitHubStarRecord, incoming: GitHubStarRecord): boolean {
  const keys: Array<keyof GitHubStarRecord> = [
    'fullName',
    'owner',
    'name',
    'htmlUrl',
    'description',
    'homepageUrl',
    'language',
    'stargazersCount',
    'forksCount',
    'openIssuesCount',
    'isArchived',
    'isFork',
    'defaultBranch',
    'pushedAt',
    'updatedAt',
    'starredAt',
  ];
  for (const key of keys) {
    if (existing[key] !== incoming[key]) return true;
  }
  return existing.topics.join('\n') !== incoming.topics.join('\n');
}

export async function syncGitHubStars(options: SyncGitHubStarsOptions = {}): Promise<SyncGitHubStarsResult> {
  const cachePath = githubStarsCachePath();
  const metaPath = githubStarsMetaPath();
  const existing = new Map<string, GitHubStarRecord>();
  let meta: GitHubStarsMeta | null = null;

  if (!options.rebuild && await pathExists(cachePath)) {
    for (const record of await readJsonLines<GitHubStarRecord>(cachePath)) {
      existing.set(record.fullName, record);
    }
  }

  if (!options.rebuild && await pathExists(metaPath)) {
    try {
      meta = await readJson<GitHubStarsMeta>(metaPath);
    } catch {
      meta = null;
    }
  }

  const fetched = await fetchGitHubStars({
    ...options,
    lastStarredAt: meta?.lastStarredAt ?? null,
    rebuild: Boolean(options.rebuild),
    perPage: 100,
  });

  let added = 0;
  let updated = 0;
  for (const record of fetched.records) {
    const previous = existing.get(record.fullName);
    if (!previous) {
      added += 1;
      existing.set(record.fullName, record);
    } else if (materialGitHubStarChanged(previous, record)) {
      updated += 1;
      existing.set(record.fullName, record);
    } else {
      existing.set(record.fullName, { ...previous, syncedAt: record.syncedAt });
    }
  }

  const sortedRecords = [...existing.values()].sort((a, b) => {
    const left = a.starredAt ?? a.updatedAt ?? a.syncedAt;
    const right = b.starredAt ?? b.updatedAt ?? b.syncedAt;
    return right.localeCompare(left);
  });

  const newestStarredAt = fetched.newestStarredAt ?? meta?.lastStarredAt ?? sortedRecords.find((record) => record.starredAt)?.starredAt ?? null;

  if (!options.dryRun) {
    await mkdir(githubStarsDir(), { recursive: true });
    await writeJsonLines(cachePath, sortedRecords);
    await writeJson(metaPath, {
      lastSyncAt: new Date().toISOString(),
      lastStarredAt: newestStarredAt,
      totalStars: sortedRecords.length,
    } satisfies GitHubStarsMeta);
  }

  return {
    fetched: fetched.records.length,
    added,
    updated,
    skipped: fetched.skipped,
    total: sortedRecords.length,
    newestStarredAt,
    cachePath,
  };
}
