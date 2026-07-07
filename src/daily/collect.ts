/**
 * Daily synthesis collection: gather everything new since the last digest —
 * canonical bookmark rows across all sources plus project activity deltas.
 */

import { pathExists, readJson, readJsonLines } from '../fs.js';
import { getCanonicalBookmarksSince, type CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import { projectsCachePath } from '../projects/paths.js';
import type { ProjectRecord } from '../projects/types.js';
import { dailyMetaPath } from './paths.js';

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 7;
const MAX_ITEMS = 200;

export interface DailyMeta {
  lastRunAt?: string;
  lastDigestDate?: string;
}

export interface DailyProjectDelta {
  repo: string;
  commits: { date: string; subject: string }[];
  prompts: { timestamp: string; text: string }[];
}

export interface DailyCollection {
  date: string;
  sinceIso: string;
  untilIso: string;
  items: CanonicalRecentItem[];
  projectDeltas: DailyProjectDelta[];
}

export interface CollectDailyOptions {
  /** Explicit digest date (YYYY-MM-DD); window becomes that UTC day. */
  date?: string;
  /** Window size when no date and no watermark is available. Default: 24. */
  windowHours?: number;
  /** Stable clock injection for tests. */
  now?: Date;
}

export async function readDailyMeta(): Promise<DailyMeta> {
  const metaPath = dailyMetaPath();
  if (!(await pathExists(metaPath))) return {};
  try {
    return await readJson<DailyMeta>(metaPath);
  } catch {
    return {};
  }
}

function windowFor(options: CollectDailyOptions, meta: DailyMeta): { date: string; sinceIso: string; untilIso: string } {
  const now = options.now ?? new Date();

  if (options.date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.date)) {
      throw new Error(`Invalid --date (expected YYYY-MM-DD): ${options.date}`);
    }
    const start = new Date(`${options.date}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) throw new Error(`Invalid --date: ${options.date}`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { date: options.date, sinceIso: start.toISOString(), untilIso: end.toISOString() };
  }

  const windowHours = Math.min(options.windowHours ?? DEFAULT_WINDOW_HOURS, MAX_WINDOW_HOURS);
  const fallbackSince = new Date(now.getTime() - windowHours * 60 * 60 * 1000);
  const watermark = meta.lastRunAt ? new Date(meta.lastRunAt) : null;
  const oldestAllowed = new Date(now.getTime() - MAX_WINDOW_HOURS * 60 * 60 * 1000);

  let since = watermark && !Number.isNaN(watermark.getTime()) ? watermark : fallbackSince;
  if (since.getTime() < oldestAllowed.getTime()) since = oldestAllowed;
  if (since.getTime() > now.getTime()) since = fallbackSince;

  return { date: now.toISOString().slice(0, 10), sinceIso: since.toISOString(), untilIso: now.toISOString() };
}

function withinWindow(iso: string | undefined, sinceIso: string, untilIso: string): boolean {
  if (!iso) return false;
  return iso >= sinceIso && iso < untilIso;
}

async function collectProjectDeltas(sinceIso: string, untilIso: string): Promise<DailyProjectDelta[]> {
  const cachePath = projectsCachePath();
  if (!(await pathExists(cachePath))) return [];

  const records = await readJsonLines<ProjectRecord>(cachePath);
  const deltas: DailyProjectDelta[] = [];

  for (const record of records) {
    const commits = record.recentCommits
      .filter((commit) => withinWindow(commit.date, sinceIso, untilIso))
      .map((commit) => ({ date: commit.date, subject: commit.subject }));
    const prompts = (record.recentPrompts ?? [])
      .filter((prompt) => withinWindow(prompt.timestamp, sinceIso, untilIso))
      .map((prompt) => ({ timestamp: prompt.timestamp, text: prompt.text }));
    if (commits.length > 0 || prompts.length > 0) {
      deltas.push({ repo: record.repo, commits, prompts });
    }
  }

  return deltas.sort((a, b) => (b.commits.length + b.prompts.length) - (a.commits.length + a.prompts.length));
}

export async function collectDaily(options: CollectDailyOptions = {}): Promise<DailyCollection> {
  const meta = await readDailyMeta();
  const { date, sinceIso, untilIso } = windowFor(options, meta);

  const items = (await getCanonicalBookmarksSince(sinceIso, MAX_ITEMS))
    .filter((item) => withinWindow(item.firstSavedAt ?? undefined, sinceIso, untilIso));
  const projectDeltas = await collectProjectDeltas(sinceIso, untilIso);

  return { date, sinceIso, untilIso, items, projectDeltas };
}
