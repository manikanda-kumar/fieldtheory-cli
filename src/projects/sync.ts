/**
 * Local projects sync orchestration: scan depth-1 git repos, write JSONL/meta,
 * and emit deterministic markdown for agent-readable work context.
 */

import { writeJson, writeJsonLines } from '../fs.js';
import { scanProjects } from './scan.js';
import { emitProjectsMarkdown } from './markdown.js';
import { ensureProjectsDir, ensureProjectsLibraryDir, projectsCachePath, projectsMetaPath, projectsLibraryDir } from './paths.js';
import type { ProjectRecord, ProjectSyncOptions, ProjectSyncResult, ProjectsMeta } from './types.js';

function sortedForCache(records: ProjectRecord[]): ProjectRecord[] {
  return [...records].sort((a, b) => {
    const byCommit = (Date.parse(b.lastCommitAt ?? '') || 0) - (Date.parse(a.lastCommitAt ?? '') || 0);
    if (byCommit !== 0) return byCommit;
    return a.repo.localeCompare(b.repo);
  });
}

export async function syncProjects(options: ProjectSyncOptions = {}): Promise<ProjectSyncResult> {
  ensureProjectsDir();
  ensureProjectsLibraryDir();

  const now = options.now ?? new Date();
  const scanResult = await scanProjects({ ...options, now });
  const records = sortedForCache(scanResult.records);
  const cachePath = projectsCachePath();
  const metaPath = projectsMetaPath();

  await writeJsonLines(cachePath, records);

  const meta: ProjectsMeta = {
    lastSyncedAt: scanResult.scannedAt,
    scanRoot: scanResult.scanRoot,
    repoCount: records.length,
    errors: scanResult.errors,
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
