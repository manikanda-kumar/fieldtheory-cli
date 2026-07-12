/**
 * Daily synthesis: turn the collected + connected material into a themed
 * markdown digest via the LLM engine chain, with citation validation so the
 * digest can never reference items that were not actually collected.
 */

import path from 'node:path';

import { pathExists, writeJson } from '../fs.js';
import { writeMd } from '../fs.js';
import { invokeEngineAsync, resolveEngine, withSystemOverride, type EngineRunProfile } from '../engine.js';
import { extractJsonArray } from '../bookmark-classify-llm.js';
import type { CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import { loadYoutubeState } from '../youtube/state.js';
import { readDailyMeta, type DailyCollection } from './collect.js';
import type { ConnectedItem, RelatedRef } from './connect.js';
import { collectDailyCoverage, type DailyCoverage } from './coverage.js';
import { dailyDigestPath, dailyMetaPath, ensureDailyDir, ensureDailyLibraryDir } from './paths.js';

const SNIPPET_CHARS = 240;
const MAX_THEMES = 7;
// Historically, 21% of X bookmarks and 29% of Raindrop items were bare link
// shares. Excluding these saves prevents URL/title-word matching from wasting
// synthesis context without discarding them from the digest.
export const THIN_CONTENT_CHARS = 120;

/** Length of meaningful saved text after URL-only content is removed. */
export function contentLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().length;
}

export interface DailyExternalNote {
  claim: string;
  sourceUrl?: string;
  sourceLabel?: string;
  /** Short ids (i1/r1) this note grounds, when provided by the model. */
  aboutIds: string[];
}

export interface DailyTheme {
  title: string;
  summary: string;
  itemIds: string[];
  relatedIds: string[];
  projects: string[];
  /** Optional X/web-grounded notes that flesh out the theme (validated URLs). */
  externalNotes: DailyExternalNote[];
}

export interface SynthesizeDailyOptions {
  profile?: EngineRunProfile;
  /** Test seam: replaces engine resolution + invocation. */
  invoke?: (prompt: string) => Promise<string>;
  /** Overwrite an existing digest for the same date. */
  force?: boolean;
  /** Current digest items supplied with a cached or fresh link enrichment. */
  enrichedCount?: number;
  /** Enriched items join the LLM partition even if a concise summary is under the normal text threshold. */
  enrichedItemIds?: Iterable<string>;
  /**
   * Allow the engine to use web/X search and attach grounded external notes.
   * Prefer with the grok engine (built-in search). Citation validation still
   * drops invented library item ids; external notes are URL-validated only.
   */
  groundExternal?: boolean;
}

export interface SynthesizeDailyResult {
  digestPath: string;
  themes: DailyTheme[];
  usedLlm: boolean;
  droppedCitations: number;
  themedCount: number;
  alsoSavedCount: number;
  /** Thin items are a subset of alsoSavedCount, never a separate rendering path. */
  thinSkipped: number;
  enrichedCount: number;
  skipped: boolean;
}

function snippet(item: CanonicalRecentItem): string {
  return item.searchText.replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS);
}

export interface DailyAliases {
  /** Short prompt alias (i1, r2, ...) → real canonical id. */
  items: Map<string, string>;
  related: Map<string, string>;
}

/** Long canonical hash ids get mangled by smaller models; the prompt uses
 *  short ordinal aliases (i1/r1) and citations are mapped back locally. */
export function buildDailyAliases(collection: DailyCollection, connected: ConnectedItem[]): DailyAliases {
  const items = new Map<string, string>();
  collection.items.forEach((item, index) => items.set(`i${index + 1}`, item.id));

  const related = new Map<string, string>();
  const seen = new Set<string>();
  let counter = 0;
  for (const { related: refs } of connected) {
    for (const ref of refs) {
      if (seen.has(ref.id)) continue;
      seen.add(ref.id);
      counter += 1;
      related.set(`r${counter}`, ref.id);
    }
  }
  return { items, related };
}

export function buildDailyPrompt(
  collection: DailyCollection,
  connected: ConnectedItem[],
  aliases: DailyAliases,
  options: { groundExternal?: boolean } = {},
): string {
  const itemAlias = new Map([...aliases.items.entries()].map(([alias, id]) => [id, alias]));
  const relatedAlias = new Map([...aliases.related.entries()].map(([alias, id]) => [id, alias]));
  const groundExternal = Boolean(options.groundExternal);

  const lines: string[] = [];
  lines.push(`Date: ${collection.date}`);
  lines.push('');
  lines.push('NEW ITEMS (saved today):');
  for (const { item, related } of connected) {
    lines.push(`- id=${itemAlias.get(item.id)} source=${item.sources.join(',')} title=${JSON.stringify(item.displayTitle ?? item.canonicalUrl ?? item.id)}`);
    lines.push(`  snippet: ${snippet(item)}`);
    for (const ref of related) {
      lines.push(`  related: id=${relatedAlias.get(ref.id)} title=${JSON.stringify(ref.title ?? ref.url ?? ref.id)}`);
    }
  }
  lines.push('');
  lines.push('PROJECT ACTIVITY (repos worked on in this window):');
  for (const delta of collection.projectDeltas) {
    const subjects = delta.commits.slice(0, 5).map((commit) => commit.subject).join('; ');
    const questions = delta.prompts.slice(0, 3).map((prompt) => prompt.text.slice(0, 120)).join(' | ');
    lines.push(`- repo=${delta.repo} commits=[${subjects}] questions=[${questions}]`);
  }
  lines.push('');
  lines.push(`TASK: Group the new items into 3-${MAX_THEMES} themes. Respond with ONLY a JSON array:`);
  if (groundExternal) {
    lines.push('[{"title": "...", "summary": "2-4 sentences on what is new and why it matters together",');
    lines.push('  "itemIds": ["<id like i1 from NEW ITEMS>"], "relatedIds": ["<id like r1 from related lines>"], "projects": ["<repo from PROJECT ACTIVITY>"],');
    lines.push('  "externalNotes": [{"claim": "one grounded fact that adds context", "sourceUrl": "https://...", "sourceLabel": "optional short source name", "aboutIds": ["i1"]}]}]');
    lines.push('Rules: cite only the short ids (i1, i2, r1, ...) and repo names that appear verbatim above for itemIds/relatedIds/projects. Mention a project only when a theme genuinely connects to that repo\'s activity. Do not invent library items, ids, or repos.');
    lines.push('External notes: you MAY use web and X search to ground additional context (author background, related announcement, clarifying fact). Prefer 0-3 externalNotes per theme. Every external note MUST include a real https sourceUrl you verified via search. aboutIds may only use short ids from this prompt. If search finds nothing useful, omit externalNotes or return []. Never fabricate URLs or claims.');
  } else {
    lines.push('[{"title": "...", "summary": "2-4 sentences on what is new and why it matters together",');
    lines.push('  "itemIds": ["<id like i1 from NEW ITEMS>"], "relatedIds": ["<id like r1 from related lines>"], "projects": ["<repo from PROJECT ACTIVITY>"]}]');
    lines.push('Rules: cite only the short ids (i1, i2, r1, ...) and repo names that appear verbatim above. Mention a project only when a theme genuinely connects to that repo\'s activity. Do not invent items, ids, or repos. Do not add external web claims.');
  }

  return withSystemOverride('personal knowledge-synthesis engine that groups newly saved reading material into themes', lines.join('\n'));
}

const MAX_EXTERNAL_NOTES_PER_THEME = 3;

/** Accept only absolute http(s) URLs for external notes — blocks invented paths. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function mapAliases(value: unknown, aliasMap: Map<string, string>): { kept: string[]; removed: number } {
  if (!Array.isArray(value)) return { kept: [], removed: 0 };
  const kept: string[] = [];
  let removed = 0;
  for (const alias of value) {
    const real = typeof alias === 'string' ? aliasMap.get(alias.trim()) : undefined;
    if (real && !kept.includes(real)) kept.push(real);
    else removed += 1;
  }
  return { kept, removed };
}

function parseExternalNotes(
  value: unknown,
  aliases: DailyAliases,
): { notes: DailyExternalNote[]; dropped: number } {
  if (!Array.isArray(value)) return { notes: [], dropped: 0 };
  const notes: DailyExternalNote[] = [];
  let dropped = 0;
  for (const entry of value.slice(0, MAX_EXTERNAL_NOTES_PER_THEME)) {
    if (!entry || typeof entry !== 'object') {
      dropped += 1;
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    const claim = typeof candidate.claim === 'string' ? candidate.claim.trim() : '';
    const sourceUrl = typeof candidate.sourceUrl === 'string' ? candidate.sourceUrl.trim() : '';
    const sourceLabel = typeof candidate.sourceLabel === 'string' ? candidate.sourceLabel.trim() : '';
    if (!claim || !sourceUrl || !isHttpUrl(sourceUrl)) {
      dropped += 1;
      continue;
    }
    // aboutIds may reference item or related aliases; unknown aliases are dropped, not fatal.
    const aboutAliases = mapAliases(candidate.aboutIds, new Map([...aliases.items, ...aliases.related]));
    notes.push({
      claim,
      sourceUrl,
      ...(sourceLabel ? { sourceLabel } : {}),
      aboutIds: aboutAliases.kept,
    });
  }
  return { notes, dropped };
}

export function validateThemes(raw: unknown, collection: DailyCollection, connected: ConnectedItem[], aliases: DailyAliases): { themes: DailyTheme[]; dropped: number } {
  const repos = new Set(collection.projectDeltas.map((delta) => delta.repo));
  const citedItems = new Set<string>();
  const themes: DailyTheme[] = [];
  let dropped = 0;

  if (!Array.isArray(raw)) return { themes, dropped };

  for (const entry of raw.slice(0, MAX_THEMES)) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
    const summary = typeof candidate.summary === 'string' ? candidate.summary.trim() : '';
    if (!title || !summary) continue;

    const keepRepos = (value: unknown): { kept: string[]; removed: number } => {
      if (!Array.isArray(value)) return { kept: [], removed: 0 };
      const kept: string[] = [];
      let removed = 0;
      for (const repo of value) {
        if (typeof repo === 'string' && repos.has(repo) && !kept.includes(repo)) kept.push(repo);
        else removed += 1;
      }
      return { kept, removed };
    };

    const items = mapAliases(candidate.itemIds, aliases.items);
    const uniqueItems = items.kept.filter((id) => {
      if (citedItems.has(id)) return false;
      citedItems.add(id);
      return true;
    });
    const related = mapAliases(candidate.relatedIds, aliases.related);
    const projects = keepRepos(candidate.projects);
    const external = parseExternalNotes(candidate.externalNotes, aliases);
    dropped += items.removed + related.removed + projects.removed + external.dropped;

    if (uniqueItems.length === 0) {
      continue;
    }

    themes.push({
      title,
      summary,
      itemIds: uniqueItems,
      relatedIds: related.kept,
      projects: projects.kept,
      externalNotes: external.notes,
    });
  }

  return { themes, dropped };
}

function mechanicalThemes(collection: DailyCollection): DailyTheme[] {
  const bySource = new Map<string, string[]>();
  for (const item of collection.items) {
    const key = item.sources[0] ?? 'other';
    const list = bySource.get(key) ?? [];
    list.push(item.id);
    bySource.set(key, list);
  }
  return [...bySource.entries()].map(([source, ids]) => ({
    title: `New from ${source}`,
    summary: `${ids.length} item(s) saved from ${source} in this window.`,
    itemIds: ids,
    relatedIds: [],
    projects: [],
    externalNotes: [],
  }));
}

/** Pull a YouTube video id out of watch/youtu.be/shorts/embed URLs. */
export function extractYoutubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{6,})/,
  );
  return match ? match[1] : null;
}

/** Map videoId → digest-relative link to its library notes .md, for every
 *  YouTube URL among the digest's items and related refs. */
export async function buildYoutubeNotesLinks(
  urls: Array<string | null | undefined>,
  digestPath: string,
): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const videoIds = new Set<string>();
  for (const url of urls) {
    const videoId = extractYoutubeVideoId(url);
    if (videoId) videoIds.add(videoId);
  }
  if (videoIds.size === 0) return links;

  let state;
  try {
    state = await loadYoutubeState();
  } catch {
    return links;
  }
  const digestDir = path.dirname(digestPath);
  for (const videoId of videoIds) {
    const notesPath = state.videos[videoId]?.artifacts?.notesPath;
    if (!notesPath || !(await pathExists(notesPath))) continue;
    links.set(videoId, path.relative(digestDir, notesPath).split(path.sep).join('/'));
  }
  return links;
}

export function renderDigestMarkdown(
  collection: DailyCollection,
  connected: ConnectedItem[],
  themes: DailyTheme[],
  alsoSavedIds: string[],
  usedLlm: boolean,
  youtubeNotes: Map<string, string> = new Map(),
  coverage: DailyCoverage,
): string {
  const notesSuffix = (url: string | null | undefined): string => {
    const videoId = extractYoutubeVideoId(url);
    const link = videoId ? youtubeNotes.get(videoId) : undefined;
    return link ? ` · [notes](${link})` : '';
  };
  const linkLabel = (value: string): string => value.replace(/\s+/g, ' ').replace(/[[\]]/g, '').trim().slice(0, 120);
  const itemById = new Map(collection.items.map((item) => [item.id, item]));
  const relatedById = new Map<string, RelatedRef>();
  for (const { related } of connected) {
    for (const ref of related) relatedById.set(ref.id, ref);
  }
  const sources = [...new Set(collection.items.flatMap((item) => item.sources))].sort();
  const renderItem = (item: CanonicalRecentItem, id: string): string => {
    const label = linkLabel(item.displayTitle ?? item.canonicalUrl ?? id);
    const savedMs = item.firstSavedAt ? Date.parse(item.firstSavedAt) : NaN;
    const saved = Number.isFinite(savedMs) ? new Date(savedMs).toISOString().slice(0, 10) : collection.date;
    return `- ${item.canonicalUrl ? `[${label}](${item.canonicalUrl})` : label} — ${item.sources.join(', ')}, saved ${saved}${notesSuffix(item.canonicalUrl)}`;
  };

  const lines: string[] = [];
  lines.push('---');
  lines.push(`date: "${collection.date}"`);
  lines.push(`new_items: ${collection.items.length}`);
  lines.push(`sources: [${sources.join(', ')}]`);
  lines.push(`themes: ${themes.length}`);
  lines.push(`synthesis: ${usedLlm ? 'llm' : 'mechanical'}`);
  lines.push(`collected: ${coverage.counts.collected}`);
  lines.push(`themed: ${coverage.counts.themed}`);
  lines.push(`also_saved: ${coverage.counts.alsoSaved}`);
  lines.push(`thin_skipped: ${coverage.counts.thinSkipped}`);
  lines.push(`enriched: ${coverage.counts.enriched}`);
  lines.push(`carried_over: ${coverage.counts.carriedOver}`);
  lines.push(`citations_dropped: ${coverage.counts.citationsDropped}`);
  lines.push(`undateable_excluded: ${coverage.counts.undateableExcluded}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Daily Digest — ${collection.date}`);
  lines.push('');

  for (const theme of themes) {
    lines.push(`## ${theme.title}`);
    lines.push('');
    lines.push(theme.summary);
    lines.push('');
    for (const id of theme.itemIds) {
      const item = itemById.get(id);
      if (!item) continue;
      lines.push(renderItem(item, id));
    }
    if (theme.relatedIds.length > 0) {
      lines.push('');
      lines.push('Connects to earlier saves:');
      for (const id of theme.relatedIds) {
        const ref = relatedById.get(id);
        if (!ref) continue;
        const label = linkLabel(ref.title ?? ref.url ?? id);
        lines.push(`- ${ref.url ? `[${label}](${ref.url})` : label}${notesSuffix(ref.url)}`);
      }
    }
    if (theme.externalNotes.length > 0) {
      lines.push('');
      lines.push('Additional context (web/X):');
      for (const note of theme.externalNotes) {
        const label = linkLabel(note.sourceLabel || note.sourceUrl || 'source');
        const link = note.sourceUrl ? `[${label}](${note.sourceUrl})` : label;
        lines.push(`- ${note.claim} — ${link}`);
      }
    }
    if (theme.projects.length > 0) {
      lines.push('');
      lines.push(`Active projects: ${theme.projects.map((repo) => `[[project:${repo}]]`).join(', ')}`);
    }
    lines.push('');
  }

  if (alsoSavedIds.length > 0) {
    lines.push('## Also saved');
    lines.push('');
    for (const id of alsoSavedIds) {
      const item = itemById.get(id);
      if (!item) continue;
      lines.push(renderItem(item, id));
    }
    lines.push('');
  }

  if (collection.projectDeltas.length > 0) {
    lines.push('## Project activity');
    lines.push('');
    for (const delta of collection.projectDeltas) {
      lines.push(`- [[project:${delta.repo}]] — ${delta.commits.length} commit(s), ${delta.prompts.length} agent prompt(s)`);
    }
    lines.push('');
  }

  lines.push('## Coverage');
  lines.push('');
  lines.push('Source freshness:');
  for (const source of ['x', 'raindrop', 'github-stars', 'youtube', 'projects'] as const) {
    lines.push(`- ${source}: ${coverage.freshness[source]}`);
  }
  lines.push('- Dark sources: x-list and following are not yet in the canonical index.');
  // thinSkipped is included in alsoSaved, preserving collected = themed + also-saved.
  lines.push(`- This run: collected ${coverage.counts.collected}; themed ${coverage.counts.themed}; also-saved ${coverage.counts.alsoSaved}; thin links skipped from synthesis ${coverage.counts.thinSkipped}; carried-over ${coverage.counts.carriedOver}; enriched links available to this digest ${coverage.counts.enriched}; citations dropped ${coverage.counts.citationsDropped}; undateable excluded (canonical total) ${coverage.counts.undateableExcluded}; synthesis ${coverage.counts.synthesis}.`);
  lines.push('');

  return lines.join('\n');
}

async function defaultInvoke(profile: EngineRunProfile, prompt: string): Promise<string> {
  const engine = await resolveEngine(profile);
  return invokeEngineAsync(engine, prompt);
}

export async function synthesizeDaily(
  collection: DailyCollection,
  connected: ConnectedItem[],
  options: SynthesizeDailyOptions = {},
): Promise<SynthesizeDailyResult> {
  ensureDailyDir();
  ensureDailyLibraryDir();
  const digestPath = dailyDigestPath(collection.date);
  const groundExternal = Boolean(options.groundExternal);

  if (collection.items.length === 0 && collection.projectDeltas.length === 0) {
    return {
      digestPath,
      themes: [],
      usedLlm: false,
      droppedCitations: 0,
      themedCount: 0,
      alsoSavedCount: 0,
      thinSkipped: 0,
      enrichedCount: options.enrichedCount ?? 0,
      skipped: true,
    };
  }

  let themes: DailyTheme[] = [];
  let usedLlm = false;
  let droppedCitations = 0;
  let llmFailed = false;
  const enrichedItemIds = new Set(options.enrichedItemIds ?? []);
  const promptItems = collection.items.filter((item) => contentLength(item.searchText) >= THIN_CONTENT_CHARS || enrichedItemIds.has(item.id));
  const thinSkipped = collection.items.length - promptItems.length;

  if (promptItems.length > 0) {
    const promptItemIds = new Set(promptItems.map((item) => item.id));
    const promptCollection: DailyCollection = { ...collection, items: promptItems };
    const promptConnected = connected.filter(({ item }) => promptItemIds.has(item.id));
    try {
      const aliases = buildDailyAliases(promptCollection, promptConnected);
      const profile: EngineRunProfile = {
        ...(options.profile ?? {}),
        // Grounded digests need the engine's web/X tools when available (grok).
        ...(groundExternal ? { webSearch: true } : {}),
      };
      const invoke = options.invoke ?? ((prompt: string) => defaultInvoke(profile, prompt));
      const raw = await invoke(buildDailyPrompt(promptCollection, promptConnected, aliases, { groundExternal }));
      const jsonText = extractJsonArray(raw);
      if (jsonText) {
        const validated = validateThemes(JSON.parse(jsonText), promptCollection, promptConnected, aliases);
        themes = validated.themes;
        droppedCitations = validated.dropped;
        usedLlm = themes.length > 0;
      } else llmFailed = true;
    } catch {
      // LLM unavailable or invalid output — fall back to mechanical grouping.
      llmFailed = true;
    }
    // On an LLM failure the fallback intentionally covers all items, including
    // thin links: it is a mechanical availability fallback, not synthesis.
    if (llmFailed) themes = mechanicalThemes(collection);
  }

  const themedIds = new Set(themes.flatMap((theme) => theme.itemIds));
  const alsoSavedIds = collection.items
    .filter((item) => !themedIds.has(item.id))
    .map((item) => item.id);

  const youtubeNotes = await buildYoutubeNotesLinks(
    [
      ...collection.items.map((item) => item.canonicalUrl),
      ...connected.flatMap(({ related }) => related.map((ref) => ref.url)),
    ],
    digestPath,
  );
  const coverage = await collectDailyCoverage({
    collected: collection.items.length,
    themed: themedIds.size,
    alsoSaved: alsoSavedIds.length,
    thinSkipped,
    enriched: options.enrichedCount ?? 0,
    carriedOver: collection.carriedOver,
    citationsDropped: droppedCitations,
    undateableExcluded: collection.undateableExcluded,
    synthesis: usedLlm ? 'llm' : 'mechanical',
  });
  await writeMd(digestPath, renderDigestMarkdown(collection, connected, themes, alsoSavedIds, usedLlm, youtubeNotes, coverage));
  if (!collection.isExplicitDate) {
    const meta = await readDailyMeta();
    const { lastRunItemId: _lastRunItemId, ...metaWithoutCursor } = meta;
    await writeJson(dailyMetaPath(), {
      ...metaWithoutCursor,
      lastRunAt: collection.nextWatermark,
      ...(collection.nextWatermarkItemId ? { lastRunItemId: collection.nextWatermarkItemId } : {}),
      lastDigestDate: collection.date,
    });
  }
  // Historical --date renders are deliberately read-only for daily metadata:
  // lastDigestDate reflects the most recent rolling digest, just like lastRunAt.

  return {
    digestPath,
    themes,
    usedLlm,
    droppedCitations,
    themedCount: themedIds.size,
    alsoSavedCount: alsoSavedIds.length,
    thinSkipped,
    enrichedCount: options.enrichedCount ?? 0,
    skipped: false,
  };
}
