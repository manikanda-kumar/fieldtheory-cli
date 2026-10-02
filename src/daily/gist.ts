/**
 * Per-item gists for the daily digest: a complete headline plus a short,
 * self-sufficient summary written by the LLM from the fullest source material
 * available locally (full saved text, link enrichment, YouTube notes).
 *
 * The mechanical excerpt in `summary.ts` can only cut the saved text, so it
 * splits X posts mid-word between title and body, stops YouTube notes after
 * the opening sentences, and repeats feed boilerplate. Gists replace it where
 * the engine succeeds; every failure falls back to that excerpt per item.
 */

import fs from 'node:fs/promises';

import { extractJsonArray } from '../bookmark-classify-llm.js';
import type { CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import { withSystemOverride } from '../engine.js';

const SAVED_TEXT_CHARS = 2400;
const NOTES_CHARS = 5000;
const BATCH_SIZE = 12;
const CONCURRENCY = 3;
/** Above this a "headline" is a paragraph; keep the saved title instead. */
const MAX_HEADLINE_CHARS = 140;
const MAX_GIST_CHARS = 900;

export interface DailyGist {
  /** Complete, untruncated headline; absent when the saved title is kept. */
  headline?: string;
  gist: string;
}

export interface GenerateGistsOptions {
  invoke: (prompt: string) => Promise<string>;
  /** Item id → absolute path of its YouTube notes markdown. */
  notesPaths?: Map<string, string>;
  batchSize?: number;
  concurrency?: number;
  onBatchError?: (error: string) => void;
}

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** The summary and key points of a notes file; chapters and metadata add length, not gist. */
export function notesMaterial(markdown: string): string {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '');
  const stop = body.search(/^## (?:Chapters|Action items|Topics|Quality warnings)\b/m);
  const head = (stop === -1 ? body : body.slice(0, stop)).replace(/^# .*$/m, '');
  return compact(head).slice(0, NOTES_CHARS);
}

async function materialFor(item: CanonicalRecentItem, notesPath: string | undefined): Promise<string> {
  const saved = compact(item.searchText).slice(0, SAVED_TEXT_CHARS);
  if (!notesPath) return saved;
  try {
    const notes = notesMaterial(await fs.readFile(notesPath, 'utf8'));
    // Notes already cover the description that the saved text carries.
    return notes.length > saved.length ? notes : saved;
  } catch {
    return saved;
  }
}

export function buildGistPrompt(entries: Array<{ alias: string; item: CanonicalRecentItem; material: string }>): string {
  const lines: string[] = [];
  lines.push('ITEMS (each saved to a personal reading library today):');
  for (const { alias, item, material } of entries) {
    lines.push(`- id=${alias} source=${item.sources.join(',')} url=${item.canonicalUrl ?? 'none'}`);
    lines.push(`  title: ${JSON.stringify(item.displayTitle ?? '')}`);
    lines.push(`  material: ${JSON.stringify(material)}`);
  }
  lines.push('');
  lines.push('TASK: For every item write a headline and a gist so the reader gets the substance without opening the link.');
  lines.push('Respond with ONLY a JSON array: [{"id": "g1", "headline": "...", "gist": "..."}]');
  lines.push('Headline: one complete phrase of at most 90 characters, never cut off and never ending in an ellipsis. Keep the title as is when it is already a complete, descriptive title. For a social post, whose title is only the first characters of the post, write "<Author>: <what the post says>". For a bare repository name, keep "owner/repo" and add a dash and what it is.');
  lines.push('Gist: 2-4 sentences, 40-90 words. Lead with the main claim or what the thing is, then the specifics that carry it: numbers, named techniques, the steps of a workflow, the conclusion or recommendation. Do not open with "This video", "The article", "The post" or describe the format; state the content itself. Do not repeat the headline. Drop feed boilerplate, calls to subscribe, and indexing keywords.');
  lines.push('Use only facts present in the material; never add outside knowledge or guesses. If the material says too little for two sentences, write one plain sentence with what is there. If it carries no content beyond the title, return an empty gist. Write in English even when the material is in another language.');
  return withSystemOverride('editor writing short, factual summaries of saved reading material', lines.join('\n'));
}

function parseGists(raw: string, aliases: Map<string, string>): Map<string, DailyGist> {
  const gists = new Map<string, DailyGist>();
  const jsonText = extractJsonArray(raw);
  if (!jsonText) throw new Error('no JSON gist array in output');
  const parsed: unknown = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) return gists;
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? aliases.get(candidate.id.trim()) : undefined;
    if (!id) continue;
    const gist = typeof candidate.gist === 'string' ? compact(candidate.gist) : '';
    const headline = typeof candidate.headline === 'string' ? compact(candidate.headline).replace(/(?:…|\.{3})$/, '').trim() : '';
    const keepHeadline = headline.length > 0 && headline.length <= MAX_HEADLINE_CHARS;
    if (!gist && !keepHeadline) continue;
    gists.set(id, {
      ...(keepHeadline ? { headline } : {}),
      gist: gist.length <= MAX_GIST_CHARS ? gist : '',
    });
  }
  return gists;
}

/** Gist every item in batches. Never throws: a failed batch leaves its items without a gist. */
export async function generateDailyGists(
  items: CanonicalRecentItem[],
  options: GenerateGistsOptions,
): Promise<Map<string, DailyGist>> {
  const gists = new Map<string, DailyGist>();
  const batchSize = Math.max(1, options.batchSize ?? BATCH_SIZE);
  const batches: CanonicalRecentItem[][] = [];
  for (let start = 0; start < items.length; start += batchSize) batches.push(items.slice(start, start + batchSize));

  const runBatch = async (batch: CanonicalRecentItem[]): Promise<void> => {
    try {
      const aliases = new Map<string, string>();
      const entries = await Promise.all(batch.map(async (item, index) => {
        const alias = `g${index + 1}`;
        aliases.set(alias, item.id);
        return { alias, item, material: await materialFor(item, options.notesPaths?.get(item.id)) };
      }));
      const raw = await options.invoke(buildGistPrompt(entries));
      for (const [id, gist] of parseGists(raw, aliases)) gists.set(id, gist);
    } catch (error) {
      options.onBatchError?.(error instanceof Error ? error.message : String(error));
    }
  };

  let next = 0;
  const workers = Array.from({ length: Math.min(options.concurrency ?? CONCURRENCY, batches.length) }, async () => {
    while (next < batches.length) {
      const batch = batches[next];
      next += 1;
      await runBatch(batch);
    }
  });
  await Promise.all(workers);
  return gists;
}
