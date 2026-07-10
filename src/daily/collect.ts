/**
 * Daily synthesis collection: gather everything new since the last digest —
 * canonical bookmark rows across all sources plus project activity deltas.
 */

import { pathExists, readJson, readJsonLines } from '../fs.js';
import { countCanonicalUndateableBookmarks, getCanonicalBookmarksSince, type CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import { projectsCachePath } from '../projects/paths.js';
import type { ProjectRecord } from '../projects/types.js';
import { dailyMetaPath } from './paths.js';

const DEFAULT_WINDOW_HOURS = 24;
const MAX_WINDOW_HOURS = 24 * 7;
const MAX_ITEMS = 200;

export interface DailyMeta {
  lastRunAt?: string;
  /** Canonical-id tie-breaker for an overflow watermark timestamp. */
  lastRunItemId?: string;
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
  /** True when this is a historical `--date` digest rather than a rolling run. */
  isExplicitDate: boolean;
  items: CanonicalRecentItem[];
  /** Items left in this window after the capped oldest-first batch. */
  carriedOver: number;
  /** All canonical rows excluded because first_saved_at is null or unparseable. */
  undateableExcluded: number;
  /** Watermark to persist after this batch; never moves past carried-over rows. */
  nextWatermark: string;
  /** Tie-breaker paired with nextWatermark when overflow occurs. */
  nextWatermarkItemId?: string;
  projectDeltas: DailyProjectDelta[];
}

export interface CollectDailyOptions {
  /** Explicit digest date (YYYY-MM-DD); window becomes that UTC day. */
  date?: string;
  /** Window size when no date and no watermark is available. Default: 24. */
  windowHours?: number;
  /** Stable clock injection for tests. */
  now?: Date;
  /** Test seam for the production collection cap. */
  maxItems?: number;
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
  // Timestamps come in mixed formats (ISO with offsets, Twitter-style) —
  // compare parsed epochs, never raw strings.
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return false;
  return ms >= Date.parse(sinceIso) && ms < Date.parse(untilIso);
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
  const maxItems = options.maxItems ?? MAX_ITEMS;
  const persistedWatermarkMs = meta.lastRunAt ? Date.parse(meta.lastRunAt) : NaN;
  const useOverflowCursor = !options.date
    && Boolean(meta.lastRunItemId)
    // windowFor normalizes dates, so compare instants rather than ISO strings.
    && Number.isFinite(persistedWatermarkMs)
    && Date.parse(sinceIso) === persistedWatermarkMs;
  // Oldest-first means each capped rolling batch drains the backlog before
  // newer arrivals; the timestamp+id cursor below prevents equal timestamps
  // from causing a permanent tie at the watermark.
  const windowItems = await getCanonicalBookmarksSince(
    sinceIso,
    undefined,
    untilIso,
    useOverflowCursor ? meta.lastRunItemId : undefined,
  );
  const items = windowItems.slice(0, maxItems);
  const carriedOver = windowItems.length - items.length;
  const lastCollected = items.at(-1);
  const nextWatermark = carriedOver > 0 && lastCollected?.firstSavedAt
    ? lastCollected.firstSavedAt
    : untilIso;
  const nextWatermarkItemId = carriedOver > 0 ? lastCollected?.id : undefined;
  const projectDeltas = await collectProjectDeltas(sinceIso, untilIso);
  const undateableExcluded = await countCanonicalUndateableBookmarks();

  return {
    date,
    sinceIso,
    untilIso,
    isExplicitDate: Boolean(options.date),
    items,
    carriedOver,
    undateableExcluded,
    nextWatermark,
    nextWatermarkItemId,
    projectDeltas,
  };
}
