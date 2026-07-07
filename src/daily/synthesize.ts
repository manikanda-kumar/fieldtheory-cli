/**
 * Daily synthesis: turn the collected + connected material into a themed
 * markdown digest via the LLM engine chain, with citation validation so the
 * digest can never reference items that were not actually collected.
 */

import { writeJson } from '../fs.js';
import { writeMd } from '../fs.js';
import { invokeEngineAsync, resolveEngine, withSystemOverride, type EngineRunProfile } from '../engine.js';
import { extractJsonArray } from '../bookmark-classify-llm.js';
import type { CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import type { DailyCollection } from './collect.js';
import type { ConnectedItem, RelatedRef } from './connect.js';
import { dailyDigestPath, dailyMetaPath, ensureDailyDir, ensureDailyLibraryDir } from './paths.js';

const SNIPPET_CHARS = 240;
const MAX_THEMES = 7;

export interface DailyTheme {
  title: string;
  summary: string;
  itemIds: string[];
  relatedIds: string[];
  projects: string[];
}

export interface SynthesizeDailyOptions {
  profile?: EngineRunProfile;
  /** Test seam: replaces engine resolution + invocation. */
  invoke?: (prompt: string) => Promise<string>;
  /** Overwrite an existing digest for the same date. */
  force?: boolean;
}

export interface SynthesizeDailyResult {
  digestPath: string;
  themes: DailyTheme[];
  usedLlm: boolean;
  droppedCitations: number;
  skipped: boolean;
}

function snippet(item: CanonicalRecentItem): string {
  return item.searchText.replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS);
}

export function buildDailyPrompt(collection: DailyCollection, connected: ConnectedItem[]): string {
  const lines: string[] = [];
  lines.push(`Date: ${collection.date}`);
  lines.push('');
  lines.push('NEW ITEMS (saved today):');
  for (const { item, related } of connected) {
    lines.push(`- id=${item.id} source=${item.sources.join(',')} title=${JSON.stringify(item.displayTitle ?? item.canonicalUrl ?? item.id)}`);
    lines.push(`  snippet: ${snippet(item)}`);
    for (const ref of related) {
      lines.push(`  related: id=${ref.id} title=${JSON.stringify(ref.title ?? ref.url ?? ref.id)}`);
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
  lines.push('[{"title": "...", "summary": "2-4 sentences on what is new and why it matters together",');
  lines.push('  "itemIds": ["<id from NEW ITEMS>"], "relatedIds": ["<id from related lines>"], "projects": ["<repo from PROJECT ACTIVITY>"]}]');
  lines.push('Rules: every id you cite MUST appear verbatim above. Mention a project only when a theme genuinely connects to that repo\'s activity. Do not invent items, ids, or repos.');

  return withSystemOverride('personal knowledge-synthesis engine that groups newly saved reading material into themes', lines.join('\n'));
}

export function validateThemes(raw: unknown, collection: DailyCollection, connected: ConnectedItem[]): { themes: DailyTheme[]; dropped: number } {
  const itemIds = new Set(collection.items.map((item) => item.id));
  const relatedIds = new Set(connected.flatMap(({ related }) => related.map((ref) => ref.id)));
  const repos = new Set(collection.projectDeltas.map((delta) => delta.repo));
  const themes: DailyTheme[] = [];
  let dropped = 0;

  if (!Array.isArray(raw)) return { themes, dropped };

  for (const entry of raw.slice(0, MAX_THEMES)) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const title = typeof candidate.title === 'string' ? candidate.title.trim() : '';
    const summary = typeof candidate.summary === 'string' ? candidate.summary.trim() : '';
    if (!title || !summary) continue;

    const keepIds = (value: unknown, allowed: Set<string>): { kept: string[]; removed: number } => {
      if (!Array.isArray(value)) return { kept: [], removed: 0 };
      const kept: string[] = [];
      let removed = 0;
      for (const id of value) {
        if (typeof id === 'string' && allowed.has(id) && !kept.includes(id)) kept.push(id);
        else removed += 1;
      }
      return { kept, removed };
    };

    const items = keepIds(candidate.itemIds, itemIds);
    const related = keepIds(candidate.relatedIds, relatedIds);
    const projects = keepIds(candidate.projects, repos);
    dropped += items.removed + related.removed + projects.removed;

    if (items.kept.length === 0) {
      dropped += 1;
      continue;
    }

    themes.push({ title, summary, itemIds: items.kept, relatedIds: related.kept, projects: projects.kept });
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
  }));
}

function renderDigestMarkdown(
  collection: DailyCollection,
  connected: ConnectedItem[],
  themes: DailyTheme[],
  usedLlm: boolean,
): string {
  const itemById = new Map(collection.items.map((item) => [item.id, item]));
  const relatedById = new Map<string, RelatedRef>();
  for (const { related } of connected) {
    for (const ref of related) relatedById.set(ref.id, ref);
  }
  const sources = [...new Set(collection.items.flatMap((item) => item.sources))].sort();

  const lines: string[] = [];
  lines.push('---');
  lines.push(`date: "${collection.date}"`);
  lines.push(`new_items: ${collection.items.length}`);
  lines.push(`sources: [${sources.join(', ')}]`);
  lines.push(`themes: ${themes.length}`);
  lines.push(`synthesis: ${usedLlm ? 'llm' : 'mechanical'}`);
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
      const label = item.displayTitle ?? item.canonicalUrl ?? id;
      const saved = item.firstSavedAt ? item.firstSavedAt.slice(0, 10) : collection.date;
      lines.push(`- ${item.canonicalUrl ? `[${label}](${item.canonicalUrl})` : label} — ${item.sources.join(', ')}, saved ${saved}`);
    }
    if (theme.relatedIds.length > 0) {
      lines.push('');
      lines.push('Connects to earlier saves:');
      for (const id of theme.relatedIds) {
        const ref = relatedById.get(id);
        if (!ref) continue;
        const label = ref.title ?? ref.url ?? id;
        lines.push(`- ${ref.url ? `[${label}](${ref.url})` : label}`);
      }
    }
    if (theme.projects.length > 0) {
      lines.push('');
      lines.push(`Active projects: ${theme.projects.map((repo) => `[[project:${repo}]]`).join(', ')}`);
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

  if (collection.items.length === 0 && collection.projectDeltas.length === 0) {
    return { digestPath, themes: [], usedLlm: false, droppedCitations: 0, skipped: true };
  }

  let themes: DailyTheme[] = [];
  let usedLlm = false;
  let droppedCitations = 0;

  if (collection.items.length > 0) {
    try {
      const invoke = options.invoke ?? ((prompt: string) => defaultInvoke(options.profile ?? {}, prompt));
      const raw = await invoke(buildDailyPrompt(collection, connected));
      const jsonText = extractJsonArray(raw);
      if (jsonText) {
        const validated = validateThemes(JSON.parse(jsonText), collection, connected);
        themes = validated.themes;
        droppedCitations = validated.dropped;
        usedLlm = themes.length > 0;
      }
    } catch {
      // LLM unavailable or invalid output — fall back to mechanical grouping.
    }
    if (themes.length === 0) themes = mechanicalThemes(collection);
  }

  await writeMd(digestPath, renderDigestMarkdown(collection, connected, themes, usedLlm));
  await writeJson(dailyMetaPath(), { lastRunAt: collection.untilIso, lastDigestDate: collection.date });

  return { digestPath, themes, usedLlm, droppedCitations, skipped: false };
}
