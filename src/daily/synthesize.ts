/**
 * Daily synthesis: turn the collected + connected material into a themed
 * markdown digest via the LLM engine chain, with citation validation so the
 * digest can never reference items that were not actually collected.
 */

import path from 'node:path';

import { pathExists, writeJson } from '../fs.js';
import { writeBinary, writeMd } from '../fs.js';
import { invokeEngineAsync, resolveEngine, withSystemOverride, type EngineRunProfile } from '../engine.js';
import { extractJsonArray } from '../bookmark-classify-llm.js';
import { getCanonicalBookmarkById, type CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import { loadYoutubeState } from '../youtube/state.js';
import { readDailyMeta, type DailyCollection } from './collect.js';
import type { ConnectedItem, RelatedRef } from './connect.js';
import { collectDailyCoverage, type DailyCoverage } from './coverage.js';
import { dailyDigestEpubPath, dailyDigestHtmlPath, dailyDigestPath, dailyIndexPath, dailyLibraryDir, dailyMetaPath, ensureDailyDir, ensureDailyLibraryDir } from './paths.js';
import { digestMarkdownToEpub } from './epub.js';
import { renderDigestHtml } from './html.js';
import { writeDailyIndexHtml } from './index-html.js';
import { listDueReviewCards, markReviewCardsShown, queueReviewCards, type ReviewCard } from './review.js';

const SNIPPET_CHARS = 240;
const ITEM_SUMMARY_CHARS = 220;
const MAX_THEMES = 7;
// Historically, 21% of X bookmarks and 29% of Raindrop items were bare link
// shares. Excluding these saves prevents URL/title-word matching from wasting
// synthesis context without discarding them from the digest.
export const THIN_CONTENT_CHARS = 120;

/** Length of meaningful saved text after URL-only content is removed. */
export function contentLength(text: string): number {
  return text.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim().length;
}

/** The best concise summary already present in a canonical item's saved text. */
export function dailyItemSummary(item: CanonicalRecentItem): string {
  const compact = (value: string): string => value.replace(/\s+/g, ' ').trim();
  const truncate = (value: string): string => value.length <= ITEM_SUMMARY_CHARS
    ? value
    : `${value.slice(0, ITEM_SUMMARY_CHARS - 1).trimEnd()}…`;
  const explicitSummary = item.searchText.match(/(?:^|\s)summary:\s*(.+)$/is)?.[1];
  if (explicitSummary) return truncate(compact(explicitSummary));

  const title = compact(item.displayTitle ?? '');
  const text = compact(item.searchText.replace(/https?:\/\/\S+/g, ' '));
  const withoutTitle = title && text.toLowerCase().startsWith(title.toLowerCase())
    ? text.slice(title.length).trim()
    : text;
  // Merged X/Raindrop rows can leave only an author handle, tweet id, and
  // domain after the post text (which is also the title) is removed. Repeat
  // the substantive title instead of presenting that indexing metadata as a
  // summary.
  const meaningfulRemainder = withoutTitle
    .replace(/\b\d{8,}\b/g, ' ')
    .replace(/\b(?:[\w-]+\.)+[a-z]{2,}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(meaningfulRemainder.length >= 40 ? withoutTitle : title || text);
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
  /** Stable clock injection for review scheduling tests. */
  now?: Date;
  /** Write the companion HTML page beside the markdown (default true). */
  html?: boolean;
  /** Also write a Kindle/e-reader EPUB beside the markdown (default false). */
  epub?: boolean;
}

export interface SynthesizeDailyResult {
  digestPath: string;
  /** Companion HTML page, unless writing it was disabled. */
  htmlPath?: string;
  /** Companion EPUB, when --epub asked for one. */
  epubPath?: string;
  themes: DailyTheme[];
  usedLlm: boolean;
  /** Engine label that produced the themes (e.g. "grok", "agy (fallback)"). */
  llmEngine?: string;
  /** Why every LLM attempt failed, when synthesis fell back to mechanical. */
  llmError?: string;
  droppedCitations: number;
  themedCount: number;
  alsoSavedCount: number;
  /** Thin items are a subset of alsoSavedCount, never a separate rendering path. */
  thinSkipped: number;
  enrichedCount: number;
  reviewsQueued: number;
  reviewsDue: number;
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
  dueReviews: ReviewCard[] = [],
  reviewsQueued = 0,
  llmMeta: { engine?: string; error?: string } = {},
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
  const reflectionPrompt = (): string => {
    const focus = themes[0]?.title ?? collection.items[0]?.displayTitle ?? 'today\'s material';
    const project = collection.projectDeltas[0]?.repo;
    if (project) {
      return `What assumption in [[project:${project}]] might “${focus}” change? Name the smallest experiment that would test it.`;
    }
    const connectedItem = connected.find((entry) => entry.related.length > 0);
    if (connectedItem?.related[0]) {
      const older = connectedItem.related[0].title ?? connectedItem.related[0].url ?? 'an earlier save';
      return `What changed between today’s “${connectedItem.item.displayTitle ?? connectedItem.item.canonicalUrl ?? 'save'}” and ${older}? State the difference in your own words.`;
    }
    return `Which item in “${focus}” deserves 20 focused minutes, and what question will you try to answer before opening it?`;
  };

  const lines: string[] = [];
  lines.push('---');
  lines.push(`date: "${collection.date}"`);
  lines.push(`new_items: ${collection.items.length}`);
  lines.push(`sources: [${sources.join(', ')}]`);
  lines.push(`themes: ${themes.length}`);
  lines.push(`synthesis: ${usedLlm ? 'llm' : 'mechanical'}`);
  if (usedLlm && llmMeta.engine) lines.push(`synthesis_engine: "${llmMeta.engine.replace(/"/g, "'")}"`);
  if (!usedLlm && llmMeta.error) lines.push(`synthesis_error: "${llmMeta.error.replace(/"/g, "'")}"`);
  lines.push(`collected: ${coverage.counts.collected}`);
  lines.push(`themed: ${coverage.counts.themed}`);
  lines.push(`also_saved: ${coverage.counts.alsoSaved}`);
  lines.push(`thin_skipped: ${coverage.counts.thinSkipped}`);
  lines.push(`enriched: ${coverage.counts.enriched}`);
  lines.push(`carried_over: ${coverage.counts.carriedOver}`);
  lines.push(`citations_dropped: ${coverage.counts.citationsDropped}`);
  lines.push(`undateable_excluded: ${coverage.counts.undateableExcluded}`);
  lines.push(`reviews_due: ${dueReviews.length}`);
  lines.push(`reviews_queued: ${reviewsQueued}`);
  lines.push('---');
  lines.push('');
  lines.push(`# Daily Learning Review — ${collection.date}`);
  lines.push('');

  lines.push(`> **${collection.items.length} new saves · ${dueReviews.length} review${dueReviews.length === 1 ? '' : 's'} due · ${collection.projectDeltas.length} active project${collection.projectDeltas.length === 1 ? '' : 's'}**`);
  lines.push('');

  lines.push('## Recall first');
  lines.push('');
  if (dueReviews.length === 0) {
    lines.push('No reviews are due today. New learning cards are introduced tomorrow so recall stays spaced.');
  } else {
    for (const card of dueReviews) {
      lines.push(`### ${card.title}`);
      lines.push('');
      lines.push(`Saved ${card.savedAt?.slice(0, 10) ?? 'on an unknown date'} · ${card.sources.join(', ') || 'unknown source'}`);
      lines.push('');
      lines.push(`> ${card.prompt}`);
      lines.push('');
      lines.push('<details>');
      lines.push('<summary>Reveal source reminder</summary>');
      lines.push('');
      lines.push(card.answer);
      lines.push('');
      lines.push('</details>');
      lines.push('');
      lines.push(`Grade after recalling: \`ft review grade ${card.id} again|fuzzy|got-it\``);
      lines.push('');
    }
  }

  lines.push('## Today\'s throughline');
  lines.push('');
  if (usedLlm) {
    for (const theme of themes.slice(0, 3)) lines.push(`- **${theme.title}:** ${theme.summary}`);
  } else {
    lines.push('Synthesis was unavailable, so this is a structured inbox rather than a thematic briefing. The material below remains complete.');
  }
  lines.push('');

  lines.push('## Ponder');
  lines.push('');
  lines.push(`> ${reflectionPrompt()}`);
  lines.push('');
  lines.push('Write a brief answer before opening more links; the point is to connect the material to your own work.');
  lines.push('');

  lines.push('## Today\'s material');
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
      const summary = dailyItemSummary(item);
      if (summary) lines.push(`  ${summary}`);
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

  lines.push('## System details');
  lines.push('');
  lines.push('<details>');
  lines.push('<summary>Coverage and source freshness</summary>');
  lines.push('');
  lines.push('Source freshness:');
  for (const source of ['x', 'raindrop', 'github-stars', 'rss', 'youtube', 'projects'] as const) {
    lines.push(`- ${source}: ${coverage.freshness[source]}`);
  }
  lines.push('- X profiles: following and X-list members are indexed for reference, but have no save date and are excluded from this activity window.');
  // thinSkipped is included in alsoSaved, preserving collected = themed + also-saved.
  lines.push(`- This run: collected ${coverage.counts.collected}; themed ${coverage.counts.themed}; also-saved ${coverage.counts.alsoSaved}; thin links skipped from synthesis ${coverage.counts.thinSkipped}; carried-over ${coverage.counts.carriedOver}; enriched links available to this digest ${coverage.counts.enriched}; citations dropped ${coverage.counts.citationsDropped}; undateable excluded (canonical total) ${coverage.counts.undateableExcluded}; synthesis ${coverage.counts.synthesis}.`);
  lines.push('');
  lines.push('</details>');
  lines.push('');

  return lines.join('\n');
}

/**
 * Digest prompts are long and grounded runs also wait on the engine's web/X
 * tools, so the shared 120s engine default kills healthy calls (2026-07-23:
 * primary, retry, and fallback all timed out at 120s and the digest fell back
 * to mechanical). Override with FT_DAILY_TIMEOUT_MS.
 */
const DAILY_INVOKE_TIMEOUT_MS = 300_000;

function dailyInvokeTimeoutMs(): number {
  const raw = Number(process.env.FT_DAILY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DAILY_INVOKE_TIMEOUT_MS;
}

async function defaultInvoke(profile: EngineRunProfile, prompt: string): Promise<string> {
  const engine = await resolveEngine(profile);
  return invokeEngineAsync(engine, prompt, {
    timeout: dailyInvokeTimeoutMs(),
    maxBuffer: 1024 * 1024 * 4,
  });
}

interface DailyFallbackSpec {
  engine: string;
  model?: string;
}

/** Fallback engines tried, in order, after the primary and its retry. */
export function dailyFallbackChain(primaryLabel: string, env: NodeJS.ProcessEnv = process.env): DailyFallbackSpec[] {
  const candidates: DailyFallbackSpec[] = [
    {
      engine: (env.FT_DAILY_FALLBACK_ENGINE ?? 'agy').trim(),
      model: env.FT_DAILY_FALLBACK_MODEL?.trim() || undefined,
    },
    // The default model belongs to the default engine only: pairing
    // deepseek-v4-flash with a user-chosen engine makes it reject the model.
    (() => {
      const engine = (env.FT_DAILY_FALLBACK_ENGINE_2 ?? 'droid').trim();
      const model = env.FT_DAILY_FALLBACK_MODEL_2?.trim()
        || (engine === 'droid' ? 'deepseek-v4-flash' : undefined);
      return { engine, model };
    })(),
  ];
  const seen = new Set([primaryLabel]);
  const chain: DailyFallbackSpec[] = [];
  for (const candidate of candidates) {
    if (!candidate.engine || candidate.engine === 'none' || seen.has(candidate.engine)) continue;
    seen.add(candidate.engine);
    chain.push(candidate);
  }
  return chain;
}

export async function synthesizeDaily(
  collection: DailyCollection,
  connected: ConnectedItem[],
  options: SynthesizeDailyOptions = {},
): Promise<SynthesizeDailyResult> {
  ensureDailyDir();
  ensureDailyLibraryDir();
  const digestPath = dailyDigestPath(collection.date);
  const now = options.now ?? new Date();
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
      reviewsQueued: 0,
      reviewsDue: 0,
      skipped: true,
    };
  }

  let themes: DailyTheme[] = [];
  let usedLlm = false;
  let droppedCitations = 0;
  let llmEngine: string | undefined;
  let llmError: string | undefined;
  const enrichedItemIds = new Set(options.enrichedItemIds ?? []);
  const promptItems = collection.items.filter((item) => contentLength(item.searchText) >= THIN_CONTENT_CHARS || enrichedItemIds.has(item.id));
  const thinSkipped = collection.items.length - promptItems.length;

  if (promptItems.length > 0) {
    const promptItemIds = new Set(promptItems.map((item) => item.id));
    const promptCollection: DailyCollection = { ...collection, items: promptItems };
    const promptConnected = connected.filter(({ item }) => promptItemIds.has(item.id));
    const errors: string[] = [];
    try {
      const aliases = buildDailyAliases(promptCollection, promptConnected);
      const profile: EngineRunProfile = {
        ...(options.profile ?? {}),
        // Grounded digests need the engine's web/X tools when available (grok).
        ...(groundExternal ? { webSearch: true } : {}),
      };
      const prompt = buildDailyPrompt(promptCollection, promptConnected, aliases, { groundExternal });
      // Unattended runs hit transient engine flakiness: retry the primary
      // engine once, then try the fallback engine before going mechanical.
      const primaryLabel = profile.engine ?? 'default';
      const attempts: Array<{ label: string; invoke: (prompt: string) => Promise<string> }> = options.invoke
        ? [{ label: primaryLabel, invoke: options.invoke }]
        : [
            { label: primaryLabel, invoke: (p) => defaultInvoke(profile, p) },
            { label: `${primaryLabel} (retry)`, invoke: (p) => defaultInvoke(profile, p) },
            ...dailyFallbackChain(primaryLabel).map((spec, index) => ({
              label: `${spec.engine} (fallback${index === 0 ? '' : ` ${index + 1}`})`,
              // Fresh profile: the primary's model/effort don't transfer across engines.
              invoke: (p: string) => defaultInvoke({
                engine: spec.engine,
                ...(spec.model ? { model: spec.model } : {}),
                ...(groundExternal ? { webSearch: true } : {}),
              }, p),
            })),
          ];
      for (const attempt of attempts) {
        try {
          const raw = await attempt.invoke(prompt);
          const jsonText = extractJsonArray(raw);
          if (!jsonText) {
            errors.push(`${attempt.label}: no JSON theme array in output`);
            continue;
          }
          const validated = validateThemes(JSON.parse(jsonText), promptCollection, promptConnected, aliases);
          if (validated.themes.length === 0) {
            errors.push(`${attempt.label}: no theme survived citation validation`);
            continue;
          }
          themes = validated.themes;
          droppedCitations = validated.dropped;
          usedLlm = true;
          llmEngine = attempt.label;
          break;
        } catch (error) {
          errors.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      errors.push(`prompt build: ${error instanceof Error ? error.message : String(error)}`);
    }
    // On an LLM failure the fallback intentionally covers all items, including
    // thin links: it is a mechanical availability fallback, not synthesis.
    if (!usedLlm) {
      llmError = errors.join(' | ').replace(/\s+/g, ' ').slice(0, 400) || 'unknown';
      themes = mechanicalThemes(collection);
    }
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
  let relatedReviewQueue = { added: 0, total: 0 };
  if (!collection.isExplicitDate) {
    const relatedId = connected.flatMap((entry) => entry.related).at(0)?.id;
    if (relatedId) {
      const relatedItem = await getCanonicalBookmarkById(relatedId);
      if (relatedItem) {
        // One older, genuinely connected item starts the habit immediately.
        relatedReviewQueue = await queueReviewCards([relatedItem], now, { initialDelayDays: 0, maxCards: 1 });
      }
    }
  }
  const dueReviews = collection.isExplicitDate ? [] : await listDueReviewCards(now);
  const reviewQueue = collection.isExplicitDate
    ? { added: 0, total: 0 }
    : await queueReviewCards(collection.items, now);
  const reviewsQueued = relatedReviewQueue.added + reviewQueue.added;
  const llmMeta = { engine: llmEngine, error: llmError };
  const digestMarkdown = renderDigestMarkdown(
    collection, connected, themes, alsoSavedIds, usedLlm, youtubeNotes, coverage, dueReviews, reviewsQueued,
    llmMeta,
  );
  await writeMd(digestPath, digestMarkdown);
  // The markdown stays the durable artifact; the page is the readable one.
  let htmlPath: string | undefined;
  if (options.html !== false) {
    htmlPath = dailyDigestHtmlPath(collection.date);
    await writeMd(htmlPath, renderDigestHtml(
      collection, connected, themes, alsoSavedIds, usedLlm, youtubeNotes, coverage, dueReviews, reviewsQueued,
      llmMeta,
    ));
  }
  // Built from the markdown that was just written, so `ft daily --epub` on an
  // older date produces the same book without re-running synthesis.
  let epubPath: string | undefined;
  if (options.epub) {
    epubPath = dailyDigestEpubPath(collection.date);
    await writeBinary(epubPath, digestMarkdownToEpub(digestMarkdown, { date: collection.date }).epub);
  }
  try {
    await writeDailyIndexHtml(dailyLibraryDir(), {
      title: 'Daily Learning Review',
      description: 'A date-indexed archive of Field Theory’s daily learning reviews.',
      kind: 'daily',
      now,
      nav: [
        { label: 'X List summaries', href: 'x-list/index.html' },
        { label: 'YouTube library', href: '../youtube/index.html' },
      ],
    });
  } catch (error) {
    process.stderr.write(`  Warning: daily archive index regeneration failed (${dailyIndexPath()}): ${error instanceof Error ? error.message : String(error)}\n`);
  }
  if (!collection.isExplicitDate) {
    // Marked only after the digest is on disk: the rotation must reflect cards
    // the reader actually received.
    await markReviewCardsShown(dueReviews.map((card) => card.id), now);
  }
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
    htmlPath,
    epubPath,
    themes,
    usedLlm,
    llmEngine,
    llmError,
    droppedCitations,
    themedCount: themedIds.size,
    alsoSavedCount: alsoSavedIds.length,
    thinSkipped,
    enrichedCount: options.enrichedCount ?? 0,
    reviewsQueued,
    reviewsDue: dueReviews.length,
    skipped: false,
  };
}
