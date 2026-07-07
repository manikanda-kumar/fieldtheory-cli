import { readdir, readFile, stat } from 'node:fs/promises';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProjectSessionFileState, SessionPrompt } from './types.js';

const DEFAULT_RETENTION_DAYS = 14;
const MAX_PROMPT_CHARS = 2000;

interface DirEntryLike {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

interface StatLike {
  mtimeMs: number;
  size: number;
  mtime: Date;
}

export interface CollectSessionPromptsOptions {
  /** Root containing depth-1 project directories. Defaults to ~/Github. */
  scanRoot?: string;
  /** Root containing Claude Code project JSONL directories. Defaults to ~/.claude/projects. */
  claudeProjectsRoot?: string;
  /** Keep session prompts newer than this many days. Default: 14. */
  retentionDays?: number;
  /** Stable clock injection for tests. */
  now?: Date;
  /** Previously persisted file states from projects meta.json. */
  previousFileStates?: Record<string, ProjectSessionFileState>;
  /** Test seam for proving unchanged files are not read. */
  readFileText?: (filePath: string) => Promise<string>;
  /** Test seam for directory walking. */
  readDir?: (dirPath: string) => Promise<DirEntryLike[]>;
  /** Test seam for file stats. */
  statFile?: (filePath: string) => Promise<StatLike>;
  /** Test seam for decoded repo existence checks. */
  existsPath?: (filePath: string) => boolean;
}

export interface CollectSessionPromptsResult {
  prompts: SessionPrompt[];
  fileStates: Record<string, ProjectSessionFileState>;
}

function defaultClaudeProjectsRoot(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

function defaultScanRoot(): string {
  return path.join(os.homedir(), 'Github');
}

function relativeFromScanRoot(decodedPath: string, scanRoot: string): string | null {
  const normalizedDecoded = path.resolve(decodedPath);
  const normalizedRoot = path.resolve(scanRoot);
  const relative = path.relative(normalizedRoot, normalizedDecoded);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative;
}

function pathJoinCandidates(tail: string): string[] {
  const parts = tail.split('-').filter(Boolean);
  const candidates: string[] = [];

  for (let slashCount = 0; slashCount < parts.length; slashCount += 1) {
    const repoParts = parts.slice(0, parts.length - slashCount);
    const childParts = parts.slice(parts.length - slashCount);
    if (repoParts.length === 0) continue;
    const candidate = [...repoParts.join('-') ? [repoParts.join('-')] : [], ...childParts].join(path.sep);
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  }

  return candidates;
}

export function decodeClaudeProjectRepo(encoded: string, scanRoot: string, existsPath: (filePath: string) => boolean = fs.existsSync): string | null {
  const encodedRoot = path.resolve(scanRoot).replace(/\//g, '-');
  if (encoded === encodedRoot || encoded.startsWith(`${encodedRoot}-`)) {
    const tail = encoded.slice(encodedRoot.length + 1);
    for (const candidate of pathJoinCandidates(tail)) {
      if (existsPath(path.join(scanRoot, candidate))) return candidate;
    }
  }

  const naive = encoded.startsWith('-') ? path.sep + encoded.slice(1).replace(/-/g, path.sep) : encoded.replace(/-/g, path.sep);
  const relative = relativeFromScanRoot(naive, scanRoot);
  if (relative && existsPath(path.join(scanRoot, relative))) return relative;

  return null;
}

function isPlainString(value: unknown): value is string {
  return typeof value === 'string';
}

function shouldSkipPrompt(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith('<') ||
    trimmed.startsWith('Caveat:') ||
    trimmed.startsWith('[Request interrupted')
  );
}

function capPrompt(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_PROMPT_CHARS) return trimmed;
  return trimmed.slice(0, MAX_PROMPT_CHARS).trimEnd();
}

function parseSessionLine(line: string, repo: string, fallbackTimestamp: string, cutoffMs: number): SessionPrompt | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const row = parsed as {
    type?: unknown;
    isSidechain?: unknown;
    timestamp?: unknown;
    message?: { content?: unknown };
  };
  const content = row.message?.content;
  if (row.type !== 'user' || row.isSidechain === true || !isPlainString(content)) return null;
  if (shouldSkipPrompt(content)) return null;

  const timestamp = typeof row.timestamp === 'string' && row.timestamp ? row.timestamp : fallbackTimestamp;
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || timestampMs < cutoffMs) return null;

  return {
    agent: 'claude',
    repo,
    timestamp,
    text: capPrompt(content),
  };
}

async function listDirs(dirPath: string, readDir: (dirPath: string) => Promise<DirEntryLike[]>): Promise<DirEntryLike[]> {
  try {
    return await readDir(dirPath);
  } catch {
    return [];
  }
}

async function listJsonlFiles(dirPath: string, readDir: (dirPath: string) => Promise<DirEntryLike[]>): Promise<string[]> {
  try {
    const entries = await readDir(dirPath);
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
      .map((entry) => path.join(dirPath, entry.name))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function sameFileState(a: ProjectSessionFileState | undefined, b: ProjectSessionFileState): boolean {
  return !!a && a.mtimeMs === b.mtimeMs && a.size === b.size;
}

export async function collectSessionPrompts(options: CollectSessionPromptsOptions = {}): Promise<CollectSessionPromptsResult> {
  const scanRoot = options.scanRoot ?? defaultScanRoot();
  const claudeProjectsRoot = options.claudeProjectsRoot ?? defaultClaudeProjectsRoot();
  const now = options.now ?? new Date();
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const cutoffMs = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const readFileText = options.readFileText ?? ((filePath: string) => readFile(filePath, 'utf8'));
  const readDir = options.readDir ?? ((dirPath: string) => readdir(dirPath, { withFileTypes: true }));
  const statFile = options.statFile ?? stat;
  const existsPath = options.existsPath ?? fs.existsSync;
  const prompts: SessionPrompt[] = [];
  const fileStates: Record<string, ProjectSessionFileState> = {};

  const projectDirs = (await listDirs(claudeProjectsRoot, readDir))
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const dir of projectDirs) {
    const repo = decodeClaudeProjectRepo(dir.name, scanRoot, existsPath);
    if (!repo) continue;

    for (const filePath of await listJsonlFiles(path.join(claudeProjectsRoot, dir.name), readDir)) {
      let info: StatLike;
      try {
        info = await statFile(filePath);
      } catch {
        continue;
      }

      const state = { mtimeMs: info.mtimeMs, size: info.size };
      fileStates[filePath] = state;
      if (sameFileState(options.previousFileStates?.[filePath], state)) continue;

      let raw: string;
      try {
        raw = await readFileText(filePath);
      } catch {
        continue;
      }

      const fallbackTimestamp = info.mtime.toISOString();
      for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const prompt = parseSessionLine(trimmed, repo, fallbackTimestamp, cutoffMs);
        if (prompt) prompts.push(prompt);
      }
    }
  }

  prompts.sort((a, b) => {
    const byTime = (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0);
    if (byTime !== 0) return byTime;
    return a.repo.localeCompare(b.repo);
  });

  return { prompts, fileStates };
}
