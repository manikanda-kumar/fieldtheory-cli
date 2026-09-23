import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AmpThreadActivity, ProjectRecord } from './types.js';
import { normalizeProjectRemoteUrl } from './scan.js';

const execFileAsync = promisify(execFile);
const MAX_ACTIVITY_ITEMS = 200;
const MAX_EXPORTS_PER_SYNC = 200;
const MAX_TITLE_CHARS = 240;
// A backlog drain (200 exports) takes ~7 min; 5 min killed it daily so the
// backlog never shrank. Keep headroom above a full max-exports batch.
const SYNC_TIMEOUT_MS = 15 * 60_000;

interface AgentSessionsPayload {
  activity?: unknown;
  sync?: {
    listed?: unknown;
    fetched?: unknown;
    unchanged?: unknown;
    deferred?: unknown;
    errors?: unknown;
    observedAt?: unknown;
  };
}

export interface AmpCloudCollection {
  available: boolean;
  attemptedAt: string;
  activity: AmpThreadActivity[];
  listed: number;
  fetched: number;
  unchanged: number;
  deferred: number;
  exportErrors: number;
  error?: string;
}

export interface MappedAmpActivity {
  byRepo: Map<string, AmpThreadActivity[]>;
  matched: number;
  unmatched: number;
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function validIso(value: unknown): string | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function parseActivity(value: unknown): AmpThreadActivity[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<string, AmpThreadActivity>();
  for (const item of value.slice(0, MAX_ACTIVITY_ITEMS)) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== 'string' || !/^T-[0-9A-Za-z-]+$/.test(row.id)) continue;
    const updatedAt = validIso(row.updatedAt);
    if (!updatedAt || typeof row.title !== 'string') continue;
    const activity: AmpThreadActivity = {
      source: 'amp',
      threadId: row.id,
      title: row.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_CHARS),
      sourceUrl: `https://ampcode.com/threads/${row.id}`,
      updatedAt,
      createdAt: validIso(row.createdAt),
      observedAt: validIso(row.observedAt),
      threadState: typeof row.threadState === 'string' ? row.threadState.slice(0, 40) : undefined,
      threadStateObservedAt: validIso(row.threadStateObservedAt),
      repositoryUrl: typeof row.repositoryUrl === 'string' ? row.repositoryUrl : undefined,
      messageCount: Math.max(0, Math.floor(finiteNumber(row.messageCount))),
    };
    const previous = byId.get(activity.threadId);
    if (!previous || Date.parse(activity.updatedAt) > Date.parse(previous.updatedAt)) {
      byId.set(activity.threadId, activity);
    }
  }
  return [...byId.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

function errorText(error: unknown): { unavailable: boolean; message: string } {
  if (!error || typeof error !== 'object') return { unavailable: false, message: String(error) };
  const value = error as { code?: unknown; stderr?: unknown; message?: unknown };
  if (value.code === 'ENOENT') {
    return { unavailable: true, message: 'agent-sessions CLI not found; install its repo-local helper to enable Amp cloud activity' };
  }
  const stderr = typeof value.stderr === 'string' ? value.stderr.trim().split('\n').at(-1) : undefined;
  const message = stderr || (typeof value.message === 'string' ? value.message : 'agent-sessions Amp cloud sync failed');
  return { unavailable: false, message: message.slice(0, 500) };
}

export async function collectAmpCloudActivity(options: {
  command?: string | false;
  retentionDays: number;
  now: Date;
}): Promise<AmpCloudCollection> {
  const attemptedAt = options.now.toISOString();
  if (options.command === false) {
    return { available: false, attemptedAt, activity: [], listed: 0, fetched: 0, unchanged: 0, deferred: 0, exportErrors: 0 };
  }
  const command = options.command ?? process.env.AGENT_SESSIONS_CLI ?? 'agent-sessions';
  try {
    const { stdout } = await execFileAsync(command, [
      'amp-cloud', 'sync', '--json', '--since', `${options.retentionDays}d`, '--limit', String(MAX_ACTIVITY_ITEMS),
      '--max-exports', String(MAX_EXPORTS_PER_SYNC),
    ], {
      timeout: SYNC_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
    });
    const payload = JSON.parse(String(stdout)) as AgentSessionsPayload;
    const activity = parseActivity(payload.activity);
    const sync = payload.sync;
    return {
      available: true,
      attemptedAt,
      activity,
      listed: finiteNumber(sync?.listed),
      fetched: finiteNumber(sync?.fetched),
      unchanged: finiteNumber(sync?.unchanged),
      deferred: finiteNumber(sync?.deferred),
      exportErrors: Array.isArray(sync?.errors) ? sync.errors.length : 0,
    };
  } catch (error) {
    const detail = errorText(error);
    return {
      available: !detail.unavailable,
      attemptedAt,
      activity: [],
      listed: 0,
      fetched: 0,
      unchanged: 0,
      deferred: 0,
      exportErrors: 0,
      error: detail.message,
    };
  }
}

function remoteKey(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeProjectRemoteUrl(value).replace(/\/+$/, '').toLowerCase();
  return normalized || null;
}

/** Map only authoritative, unique Git remote matches. Cwd/basename guesses are deliberately excluded. */
export function mapAmpActivityToProjects(records: ProjectRecord[], activity: AmpThreadActivity[]): MappedAmpActivity {
  const reposByRemote = new Map<string, string | null>();
  for (const record of records) {
    const key = remoteKey(record.remoteUrl);
    if (!key) continue;
    reposByRemote.set(key, reposByRemote.has(key) ? null : record.repo);
  }

  const byRepo = new Map<string, AmpThreadActivity[]>();
  let matched = 0;
  let unmatched = 0;
  for (const item of activity) {
    const key = remoteKey(item.repositoryUrl);
    const repo = key ? reposByRemote.get(key) : undefined;
    if (!repo) {
      unmatched += 1;
      continue;
    }
    const items = byRepo.get(repo) ?? [];
    items.push(item);
    byRepo.set(repo, items);
    matched += 1;
  }
  for (const [repo, items] of byRepo) {
    byRepo.set(repo, items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)));
  }
  return { byRepo, matched, unmatched };
}
