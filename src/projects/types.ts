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

export interface SessionPrompt {
  agent: 'claude' | 'codex' | 'amp' | 'pi' | 'droid';
  repo: string;
  timestamp: string;
  text: string;
}

export interface ProjectRecord {
  repo: string;
  path: string;
  remoteUrl?: string;
  description?: string;
  goalNowNext?: ProjectGoalNowNext;
  lastCommitAt?: string;
  pendingFiles: number;
  unpushedCommits: number;
  recentCommits: ProjectCommit[];
  recentPrompts?: { timestamp: string; text: string }[];
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
  sessionFiles?: Record<string, ProjectSessionFileState>;
}

export interface ProjectSyncOptions extends ProjectScanOptions {
  /** Stable clock injection for tests and deterministic exports. */
  now?: Date;
  /** Skip Claude Code session prompt extraction. */
  noSessions?: boolean;
  /** Root containing Claude Code project JSONL directories. Defaults to ~/.claude/projects. */
  claudeProjectsRoot?: string;
  /** Root containing Codex rollout JSONL files. Defaults to ~/.codex/sessions. */
  codexSessionsRoot?: string;
  /** Directory containing Amp thread JSON files. Defaults to ~/.local/share/amp/threads. */
  ampThreadsRoot?: string;
  /** Root containing Pi session dirs. Defaults to ~/.pi/agent/sessions. */
  piSessionsRoot?: string;
  /** Factory droid data dir holding sessions-index.json + sessions/. Defaults to ~/.factory. */
  droidRoot?: string;
  /** Keep session prompts newer than this many days. Default: 14. */
  sessionRetentionDays?: number;
}

export interface ProjectSyncResult {
  records: ProjectRecord[];
  errors: ProjectScanError[];
  cachePath: string;
  metaPath: string;
  libraryDir: string;
  activePath: string;
}

export interface ProjectSessionFileState {
  mtimeMs: number;
  size: number;
}
