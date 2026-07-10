/**
 * Mechanical coverage accounting for daily digests.  Freshness deliberately
 * uses each source's own sync metadata instead of canonical-index mtimes:
 * X uses bookmarks-meta's incremental/full sync timestamps; Raindrop,
 * GitHub stars, and projects store their last sync in meta.json; YouTube's
 * per-playlist lastSyncedAt is the only stored sync timestamp in state.json.
 */

import { pathExists, readJson } from '../fs.js';
import { githubStarsMetaPath } from '../github-stars/paths.js';
import { latestBookmarkSyncAt } from '../bookmarks.js';
import { twitterBookmarksMetaPath, youtubeStatePath } from '../paths.js';
import { projectsMetaPath } from '../projects/paths.js';
import { raindropMetaPath } from '../raindrop/paths.js';
import type { BookmarkCacheMeta } from '../types.js';

export type CoverageFreshness = string | 'never synced' | 'unknown';

export interface DailyCoverageCounts {
  collected: number;
  themed: number;
  alsoSaved: number;
  /** Subset of alsoSaved: bare-link items omitted from the LLM prompt. */
  thinSkipped: number;
  /** Current digest items with an enrichment summary available (cached or fresh). */
  enriched: number;
  carriedOver: number;
  citationsDropped: number;
  /** Counted across the full canonical index, not just this digest window. */
  undateableExcluded: number;
  synthesis: 'llm' | 'mechanical';
}

export interface DailyCoverage {
  freshness: Record<'x' | 'raindrop' | 'github-stars' | 'youtube' | 'projects', CoverageFreshness>;
  counts: DailyCoverageCounts;
}

function timestamp(value: unknown): CoverageFreshness {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return 'unknown';
  return value;
}

async function probeMeta(path: string, pick: (value: Record<string, unknown>) => unknown): Promise<CoverageFreshness> {
  try {
    if (!(await pathExists(path))) return 'never synced';
    return timestamp(pick(await readJson<Record<string, unknown>>(path)));
  } catch {
    // A corrupt/unreadable per-source state must never prevent a digest.
    return 'unknown';
  }
}

async function probeYoutube(): Promise<CoverageFreshness> {
  try {
    if (!(await pathExists(youtubeStatePath()))) return 'never synced';
    const state = await readJson<{ playlists?: Record<string, { lastSyncedAt?: unknown }> }>(youtubeStatePath());
    const values = Object.values(state.playlists ?? {})
      .map((playlist) => playlist.lastSyncedAt)
      .filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)));
    return values.length ? values.sort().at(-1)! : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function probeX(): Promise<CoverageFreshness> {
  try {
    if (!(await pathExists(twitterBookmarksMetaPath()))) return 'never synced';
    const meta = await readJson<Pick<BookmarkCacheMeta, 'lastIncrementalSyncAt' | 'lastFullSyncAt'>>(twitterBookmarksMetaPath());
    // A full sync can finish after the last incremental sync, so freshness is
    // the newest valid timestamp across both fields.
    return latestBookmarkSyncAt(meta) ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export async function collectDailyCoverage(counts: DailyCoverageCounts): Promise<DailyCoverage> {
  const [x, raindrop, githubStars, youtube, projects] = await Promise.all([
    probeX(),
    probeMeta(raindropMetaPath(), (meta) => meta.lastSyncedAt),
    probeMeta(githubStarsMetaPath(), (meta) => meta.lastSyncAt),
    probeYoutube(),
    probeMeta(projectsMetaPath(), (meta) => meta.lastSyncedAt),
  ]);
  return { freshness: { x, raindrop, 'github-stars': githubStars, youtube, projects }, counts };
}
