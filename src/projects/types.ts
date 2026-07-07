/**
 * Type definitions for the local projects source.
 *
 * Project records are derived from depth-1 git repositories on disk. They are
 * cached as JSONL and exported to markdown so agents can cheaply read active
 * work context without touching git on every query.
 */

export interface ProjectGoalNowNext {
  goal?: string;
  now?: string;
  next?: string;
}

export interface ProjectCommit {
  hash: string;
  date: string;
  subject: string;
}

export interface ProjectRecord {
  repo: string;
  path: string;
  description?: string;
  goalNowNext?: ProjectGoalNowNext;
  lastCommitAt?: string;
  pendingFiles: number;
  unpushedCommits: number;
  recentCommits: ProjectCommit[];
  scannedAt: string;
}

export interface ProjectScanError {
  repo: string;
  path: string;
  stage: string;
  message: string;
}

export interface ProjectScanOptions {
  /** Root containing depth-1 project directories. Defaults to ~/Github. */
  scanRoot?: string;
  /** Skip repos with .git HEAD/index older than this many days. Default: 90. */
  maxAgeDays?: number;
  /** Timeout for each git invocation in milliseconds. Default: 5000. */
  gitTimeoutMs?: number;
  /** Stable clock injection for tests. */
  now?: Date;
}

export interface ProjectScanResult {
  records: ProjectRecord[];
  errors: ProjectScanError[];
  scanRoot: string;
  scannedAt: string;
}

export interface ProjectsMeta {
  lastSyncedAt: string;
  scanRoot: string;
  repoCount: number;
  errors: ProjectScanError[];
}

export interface ProjectSyncOptions extends ProjectScanOptions {
  /** Stable clock injection for tests and deterministic exports. */
  now?: Date;
}

export interface ProjectSyncResult {
  records: ProjectRecord[];
  errors: ProjectScanError[];
  cachePath: string;
  metaPath: string;
  libraryDir: string;
  activePath: string;
}
