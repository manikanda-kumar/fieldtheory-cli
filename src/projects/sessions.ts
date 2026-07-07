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
  /** Root containing Codex rollout JSONL files. Defaults to ~/.codex/sessions. */
  codexSessionsRoot?: string;
  /** Directory containing Amp thread JSON files. Defaults to ~/.local/share/amp/threads. */
  ampThreadsRoot?: string;
  /** Root containing Pi session dirs. Defaults to ~/.pi/agent/sessions. */
  piSessionsRoot?: string;
  /** Factory droid data dir holding sessions-index.json + sessions/. Defaults to ~/.factory. */
  droidRoot?: string;
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

function defaultCodexSessionsRoot(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
}

function defaultAmpThreadsRoot(): string {
  return path.join(os.homedir(), '.local', 'share', 'amp', 'threads');
}

function defaultPiSessionsRoot(): string {
  return path.join(os.homedir(), '.pi', 'agent', 'sessions');
}

function defaultDroidRoot(): string {
  return path.join(os.homedir(), '.factory');
}

/** Map an absolute working directory to the depth-1 repo name under scanRoot,
 *  or null when the path lives elsewhere. Subdirectories map to their repo. */
export function repoForCwd(cwd: string, scanRoot: string): string | null {
  const relative = relativeFromScanRoot(cwd, scanRoot);
  if (!relative) return null;
  const first = relative.split(path.sep)[0];
  return first || null;
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
    trimmed.startsWith('[Request interrupted') ||
    trimmed.startsWith('This session is being continued from a previous conversation')
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

const CODEX_NOISE_PREFIXES = ['# AGENTS.md', '## Continuity Ledger', 'SYSTEM:', 'System:', '# Task Tool Invocation'];

function isCodexNoise(text: string): boolean {
  const trimmed = text.trim();
  return shouldSkipPrompt(trimmed) || CODEX_NOISE_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

interface CodexRolloutLine {
  timestamp?: unknown;
  type?: unknown;
  payload?: {
    type?: unknown;
    cwd?: unknown;
    role?: unknown;
    content?: unknown;
  };
}

/** Parse one Codex rollout JSONL file: session_meta carries the cwd, user
 *  prompts are response_item message lines with input_text content. */
export function parseCodexRollout(raw: string, scanRoot: string, fallbackTimestamp: string, cutoffMs: number): SessionPrompt[] {
  let repo: string | null = null;
  const prompts: SessionPrompt[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: CodexRolloutLine;
    try {
      row = JSON.parse(trimmed) as CodexRolloutLine;
    } catch {
      continue;
    }

    if (row.type === 'session_meta' && typeof row.payload?.cwd === 'string') {
      repo = repoForCwd(row.payload.cwd, scanRoot);
      if (!repo) return [];
      continue;
    }

    if (!repo || row.type !== 'response_item') continue;
    const payload = row.payload;
    if (!payload || payload.type !== 'message' || payload.role !== 'user' || !Array.isArray(payload.content)) continue;

    const text = payload.content
      .filter((part): part is { type: string; text: string } =>
        !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'input_text' && typeof (part as { text?: unknown }).text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
    if (!text || isCodexNoise(text)) continue;

    const timestamp = typeof row.timestamp === 'string' && row.timestamp ? row.timestamp : fallbackTimestamp;
    const timestampMs = Date.parse(timestamp);
    if (!Number.isFinite(timestampMs) || timestampMs < cutoffMs) continue;

    prompts.push({ agent: 'codex', repo, timestamp, text: capPrompt(text) });
  }

  return prompts;
}

interface AgentMessageLine {
  type?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  message?: { role?: unknown; content?: unknown };
}

/** Join text blocks of the given type, dropping noise blocks individually —
 *  droid/codex sometimes pack an env dump and the real prompt into one message. */
function textFromContentBlocks(content: unknown, blockType: string): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((part): part is { type: string; text: string } =>
      !!part && typeof part === 'object' && (part as { type?: unknown }).type === blockType && typeof (part as { text?: unknown }).text === 'string')
    .map((part) => part.text.trim())
    .filter((text) => text && !isCodexNoise(text))
    .join('\n')
    .trim();
}

/** Parse JSONL where user turns look like
 *  {"type":"message","timestamp":...,"message":{"role":"user","content":[{"type":"text","text":...}]}}
 *  — the shape shared by Pi and Factory droid session files. */
export function parseAgentMessageLines(
  raw: string,
  agent: SessionPrompt['agent'],
  repo: string,
  fallbackTimestamp: string,
  cutoffMs: number,
): SessionPrompt[] {
  const prompts: SessionPrompt[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: AgentMessageLine;
    try {
      row = JSON.parse(trimmed) as AgentMessageLine;
    } catch {
      continue;
    }
    if (row.type !== 'message' || row.message?.role !== 'user') continue;
    const text = textFromContentBlocks(row.message.content, 'text');
    if (!text || isCodexNoise(text)) continue;

    const timestamp = typeof row.timestamp === 'string' && row.timestamp ? row.timestamp : fallbackTimestamp;
    const timestampMs = Date.parse(timestamp);
    if (!Number.isFinite(timestampMs) || timestampMs < cutoffMs) continue;
    prompts.push({ agent, repo, timestamp, text: capPrompt(text) });
  }
  return prompts;
}

/** Parse a session JSONL whose leading header line carries the cwd:
 *  Pi uses {"type":"session"}, Factory droid uses {"type":"session_start"}. */
export function parseCwdHeaderSession(
  raw: string,
  agent: SessionPrompt['agent'],
  headerTypes: readonly string[],
  scanRoot: string,
  fallbackTimestamp: string,
  cutoffMs: number,
): SessionPrompt[] {
  const firstLine = raw.slice(0, raw.indexOf('\n') === -1 ? raw.length : raw.indexOf('\n')).trim();
  let repo: string | null = null;
  try {
    const header = JSON.parse(firstLine) as AgentMessageLine;
    if (headerTypes.includes(String(header.type)) && typeof header.cwd === 'string') {
      repo = repoForCwd(header.cwd, scanRoot);
    }
  } catch {
    return [];
  }
  if (!repo) return [];
  return parseAgentMessageLines(raw, agent, repo, fallbackTimestamp, cutoffMs);
}

export function parsePiSession(raw: string, scanRoot: string, fallbackTimestamp: string, cutoffMs: number): SessionPrompt[] {
  return parseCwdHeaderSession(raw, 'pi', ['session'], scanRoot, fallbackTimestamp, cutoffMs);
}

export interface DroidIndexEntry {
  sessionId: string;
  cwd?: string;
  mtime?: number;
}

/** Read the Factory droid sessions-index.json entry list (cwd lives here, not
 *  in the session JSONL files). */
export function parseDroidIndex(raw: string): DroidIndexEntry[] {
  try {
    const parsed = JSON.parse(raw) as { entries?: unknown };
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter((entry): entry is DroidIndexEntry =>
      !!entry && typeof entry === 'object' && typeof (entry as { sessionId?: unknown }).sessionId === 'string');
  } catch {
    return [];
  }
}

interface AmpThreadJson {
  created?: unknown;
  env?: { initial?: { trees?: { uri?: unknown }[] } };
  messages?: { role?: unknown; content?: unknown }[];
}

/** Parse one Amp thread JSON file: env.initial.trees[0].uri names the repo,
 *  user messages hold text content blocks. Thread `created` (epoch ms) is the
 *  timestamp for every prompt — Amp does not stamp individual messages. */
export function parseAmpThread(raw: string, scanRoot: string, fallbackTimestamp: string, cutoffMs: number): SessionPrompt[] {
  let thread: AmpThreadJson;
  try {
    thread = JSON.parse(raw) as AmpThreadJson;
  } catch {
    return [];
  }

  const uri = thread.env?.initial?.trees?.[0]?.uri;
  if (typeof uri !== 'string' || !uri.startsWith('file://')) return [];
  const repo = repoForCwd(decodeURIComponent(uri.slice('file://'.length)), scanRoot);
  if (!repo) return [];

  const createdMs = typeof thread.created === 'number' ? thread.created : Date.parse(String(thread.created ?? ''));
  const timestamp = Number.isFinite(createdMs) ? new Date(createdMs).toISOString() : fallbackTimestamp;
  if (Date.parse(timestamp) < cutoffMs) return [];

  const prompts: SessionPrompt[] = [];
  for (const message of thread.messages ?? []) {
    if (message?.role !== 'user' || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((part): part is { type: string; text: string } =>
        !!part && typeof part === 'object' && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string')
      .map((part) => part.text)
      .join('\n')
      .trim();
    if (!text || isCodexNoise(text)) continue;
    prompts.push({ agent: 'amp', repo, timestamp, text: capPrompt(text) });
  }

  return prompts;
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

  const processParsedFile = async (
    filePath: string,
    parse: (raw: string, fallbackTimestamp: string) => SessionPrompt[],
  ): Promise<void> => {
    let info: StatLike;
    try {
      info = await statFile(filePath);
    } catch {
      return;
    }
    const state = { mtimeMs: info.mtimeMs, size: info.size };
    fileStates[filePath] = state;
    if (sameFileState(options.previousFileStates?.[filePath], state)) return;

    let raw: string;
    try {
      raw = await readFileText(filePath);
    } catch {
      return;
    }
    prompts.push(...parse(raw, info.mtime.toISOString()));
  };

  // Codex rollouts: ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl
  const codexRoot = options.codexSessionsRoot ?? defaultCodexSessionsRoot();
  const codexFiles: string[] = [];
  const walkCodex = async (dirPath: string, depth: number): Promise<void> => {
    if (depth > 3) return;
    for (const entry of await listDirs(dirPath, readDir)) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) await walkCodex(entryPath, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) codexFiles.push(entryPath);
    }
  };
  await walkCodex(codexRoot, 0);
  for (const filePath of codexFiles.sort((a, b) => a.localeCompare(b))) {
    await processParsedFile(filePath, (raw, fallback) => parseCodexRollout(raw, scanRoot, fallback, cutoffMs));
  }

  // Amp threads: ~/.local/share/amp/threads/T-*.json
  const ampRoot = options.ampThreadsRoot ?? defaultAmpThreadsRoot();
  const ampFiles = (await listDirs(ampRoot, readDir))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(ampRoot, entry.name))
    .sort((a, b) => a.localeCompare(b));
  for (const filePath of ampFiles) {
    await processParsedFile(filePath, (raw, fallback) => parseAmpThread(raw, scanRoot, fallback, cutoffMs));
  }

  // Pi sessions: ~/.pi/agent/sessions/<encoded-dir>/*.jsonl (cwd in header line)
  const piRoot = options.piSessionsRoot ?? defaultPiSessionsRoot();
  for (const dir of (await listDirs(piRoot, readDir)).filter((entry) => entry.isDirectory())) {
    for (const filePath of await listJsonlFiles(path.join(piRoot, dir.name), readDir)) {
      await processParsedFile(filePath, (raw, fallback) => parsePiSession(raw, scanRoot, fallback, cutoffMs));
    }
  }

  // Factory droid, two layouts under ~/.factory/sessions/:
  //  - current: <encoded-cwd>/<id>.jsonl with cwd in the session_start header
  //  - legacy: flat <id>.jsonl mapped via sessions-index.json (no cwd in file)
  const droidRoot = options.droidRoot ?? defaultDroidRoot();
  const droidSessionsDir = path.join(droidRoot, 'sessions');
  for (const entry of await listDirs(droidSessionsDir, readDir)) {
    if (!entry.isDirectory()) continue;
    for (const filePath of await listJsonlFiles(path.join(droidSessionsDir, entry.name), readDir)) {
      await processParsedFile(filePath, (raw, fallback) =>
        parseCwdHeaderSession(raw, 'droid', ['session_start'], scanRoot, fallback, cutoffMs));
    }
  }

  let droidIndexRaw: string | null = null;
  try {
    droidIndexRaw = await readFileText(path.join(droidRoot, 'sessions-index.json'));
  } catch {
    droidIndexRaw = null;
  }
  if (droidIndexRaw) {
    for (const entry of parseDroidIndex(droidIndexRaw)) {
      if (typeof entry.cwd !== 'string') continue;
      if (typeof entry.mtime === 'number' && entry.mtime < cutoffMs) continue;
      const repo = repoForCwd(entry.cwd, scanRoot);
      if (!repo) continue;
      const filePath = path.join(droidSessionsDir, `${entry.sessionId}.jsonl`);
      await processParsedFile(filePath, (raw, fallback) => parseAgentMessageLines(raw, 'droid', repo, fallback, cutoffMs));
    }
  }

  prompts.sort((a, b) => {
    const byTime = (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0);
    if (byTime !== 0) return byTime;
    return a.repo.localeCompare(b.repo);
  });

  return { prompts, fileStates };
}
