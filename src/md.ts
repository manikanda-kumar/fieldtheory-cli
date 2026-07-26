/**
 * Markdown wiki compilation engine.
 *
 * ft md [--full]
 *
 * Builds/updates a Karpathy-style LLM wiki from the bookmarks database.
 * Output lives in ~/.fieldtheory/library/ as plain markdown with [[wikilinks]],
 * compatible with Atomic and other markdown knowledge graph tools.
 *
 * Incremental by default: only pages whose source bookmark count changed are
 * regenerated. --full forces all pages to be rewritten.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, pathExists, readJson, writeMd, appendLine, writeJson, listFiles, readMd } from './fs.js';
import {
  mdDir, mdIndexPath, mdLogPath, mdStatePath, mdSchemaPath,
  mdCategoriesDir, mdDomainsDir, mdEntitiesDir, mdConceptsDir,
  mdSourcesDir,
  mdHtmlPath,
} from './paths.js';
import {
  getCategoryCounts, getDomainCounts, sampleByCategory, sampleByDomain,
  sampleByAuthor, getTopAuthorHandles, openBookmarksDb, type CategorySample,
} from './bookmarks-db.js';
import {
  getCanonicalCategoryCounts, getCanonicalDomainCounts, getCanonicalSourceCounts,
  sampleCanonicalByCategory, sampleCanonicalByDomain, sampleCanonicalBySource,
  type CanonicalSample,
} from './canonical-bookmarks-db.js';
import { resolveEngine, invokeEngineAsync, EngineInvocationError, type ResolvedEngine } from './engine.js';
import { ensureWikiConfig, readWikiGuidance, wikiConfigPath } from './library-config.js';
import {
  buildCategoryPagePrompt, buildDomainPagePrompt, buildEntityPagePrompt,
  buildSourcePagePrompt,
  type MdBookmark,
} from './md-prompts.js';
import { stripLlmMarkdownFence } from './md-fence.js';
import {
  htmlEscape, renderHtmlGroup, renderHtmlPage,
  type HtmlChip, type HtmlItem,
} from './html-kit.js';

const MIN_CATEGORY_COUNT = 5;
const MIN_DOMAIN_COUNT   = 5;
const MIN_ENTITY_COUNT   = 10;
const MAX_SAMPLE_SIZE    = 50;

/** Abort the compile after this many consecutive page failures — catches
 * auth expiry and rate-limit cascades before they waste hours. */
export const MAX_CONSECUTIVE_FAILURES = 5;

/** Scale timeout by sample count — large categories need more time. */
function llmOpts(sampleCount: number) {
  // Base 120s + 2s per bookmark sampled, capped at 10 min
  const timeout = Math.min(120_000 + sampleCount * 2_000, 600_000);
  return { timeout, maxBuffer: 1024 * 1024 * 4 };
}

export interface MdState {
  lastCompileAt: string;
  totalCompiles: number;
  groupCounts: Record<string, string>;
  pageHashes: Record<string, string>;
}

export interface CompileOptions {
  full?: boolean;
  only?: string[];
  engineOverride?: string;
  unified?: boolean;
  onProgress?: (status: string) => void;
  modelOverride?: string;
  effortOverride?: string;
}

export interface CompileResult {
  engine: string;
  pagesCreated: number;
  pagesUpdated: number;
  pagesSkipped: number;
  pagesFailed: number;
  totalPages: number;
  elapsed: number;
  aborted: boolean;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function loadMdState(): Promise<MdState> {
  const statePath = mdStatePath();
  if (await pathExists(statePath)) {
    try {
      return await readJson<MdState>(statePath);
    } catch { /* corrupt state → fresh compile */ }
  }
  return {
    lastCompileAt: new Date(0).toISOString(),
    totalCompiles: 0,
    groupCounts: {},
    pageHashes: {},
  };
}

function hasChanged(state: MdState, key: string, currentCount: number): boolean {
  return state.groupCounts[key] !== String(currentCount);
}

function mapToMdBookmarks(samples: CategorySample[]): MdBookmark[] {
  return samples.map((s) => ({
    id: s.id,
    url: s.url,
    text: s.text,
    authorHandle: s.authorHandle,
    categories: s.categories,
    githubUrls: s.githubUrls,
  }));
}

function mapCanonicalToMdBookmarks(samples: CanonicalSample[]): MdBookmark[] {
  return samples.map((s) => ({
    id: s.id,
    url: s.url,
    text: s.text,
    categories: s.categories,
    domains: s.domains,
  }));
}

async function writePage(
  filePath: string,
  content: string,
  state: MdState,
  relPath: string,
): Promise<'created' | 'updated' | 'unchanged'> {
  const hash = sha256(content);
  const existing = state.pageHashes[relPath];
  if (existing === hash) return 'unchanged';
  await writeMd(filePath, content);
  state.pageHashes[relPath] = hash;
  return existing ? 'updated' : 'created';
}

async function generateSchemaIfMissing(): Promise<void> {
  const schemaPath = mdSchemaPath();
  if (await pathExists(schemaPath)) return;

  const schema = `# Wiki Schema & Conventions

This file documents the structure and conventions for the FT knowledge base.
Edit it to evolve how the LLM maintains wiki pages.

## Directory Structure

\`\`\`
~/.fieldtheory/library/
├── index.md          # Content catalog (auto-generated, do not edit)
├── log.md            # Append-only compile + query log
├── md-state.json     # Internal compilation state
├── categories/       # Pages by bookmark type (tool, security, technique, …)
├── domains/          # Pages by subject matter (ai, finance, devops, …)
├── entities/         # Pages for individual authors/contributors
└── concepts/         # Q&A answers saved with ft ask --save
\`\`\`

## Frontmatter Requirements

Every page MUST have:
\`\`\`yaml
---
tags: [ft/category]  # or ft/domain, ft/entity, ft/concept
source_count: 42
source_type: bookmarks
last_updated: 2026-01-01
---
\`\`\`

## Wikilink Format

Internal cross-references use wikilink syntax:
- \`[[categories/tool]]\` — link to a category page
- \`[[domains/ai]]\` — link to a domain page
- \`[[entities/karpathy]]\` — link to an entity page

## Source Citation Rule

Every factual claim must link back to a bookmark URL:
> "Claude 3.5 Sonnet topped the LMSYS leaderboard ([source](https://x.com/...))."

## Contradiction Rule

When bookmarks in a group disagree, note it explicitly:
> **Contradiction**: Some bookmarks advocate X while others argue Y.
`;

  await writeMd(schemaPath, schema);
}

interface LibraryPage {
  /** Slug without the .md extension. */
  name: string;
  /** Path relative to the library root, e.g. "categories/tool.md". */
  rel: string;
  label: string;
  /** Bookmarks fed to the page's prompt (capped by MAX_SAMPLE_SIZE). */
  sampled: number;
  /** Canonical items behind the page, when known. */
  items?: number;
  updated: string;
  mtimeMs: number;
}

/** Real canonical item counts per page slug, so navigation can rank by depth
 *  instead of by the 50-item prompt sample recorded in frontmatter. */
async function libraryItemCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  try {
    const [categories, domains, sources] = await Promise.all([
      getCanonicalCategoryCounts(),
      getCanonicalDomainCounts(),
      getCanonicalSourceCounts(),
    ]);
    for (const [name, count] of Object.entries(categories)) counts.set(`categories/${slug(name)}`, count);
    for (const [name, count] of Object.entries(domains)) counts.set(`domains/${slug(name)}`, count);
    for (const [name, count] of Object.entries(sources)) counts.set(`sources/${slug(name)}`, count);
  } catch { /* an index-only run against a missing db still produces navigation */ }
  return counts;
}

interface LibrarySection {
  id: string;
  title: string;
  dir: string;
  pages: LibraryPage[];
}

const FRONTMATTER_COUNT = /^source_count:\s*(\d+)\s*$/m;
const FRONTMATTER_UPDATED = /^last_updated:\s*"?(\d{4}-\d{2}-\d{2})"?\s*$/m;

/** Read the cheap navigational facts out of a generated page's frontmatter. */
async function readLibraryPage(dir: string, subdir: string, file: string): Promise<LibraryPage> {
  const full = path.join(dir, file);
  const name = file.replace(/\.md$/, '');
  let sampled = 0;
  let updated = '';
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(full).mtimeMs;
  } catch { /* a page removed mid-run simply sorts last */ }
  try {
    const head = (await readMd(full)).slice(0, 600);
    sampled = Number(FRONTMATTER_COUNT.exec(head)?.[1] ?? 0);
    updated = FRONTMATTER_UPDATED.exec(head)?.[1] ?? '';
  } catch { /* unreadable page still deserves a link */ }
  if (!updated && mtimeMs) updated = new Date(mtimeMs).toISOString().slice(0, 10);
  return {
    name,
    rel: `${subdir}/${file}`,
    label: name.replace(/-/g, ' '),
    sampled,
    updated,
    mtimeMs,
  };
}

async function collectLibrarySections(counts?: Map<string, number>): Promise<LibrarySection[]> {
  const defs: Array<{ id: string; title: string; dir: string }> = [
    { id: 'sources', title: 'Sources', dir: mdSourcesDir() },
    { id: 'categories', title: 'Categories', dir: mdCategoriesDir() },
    { id: 'domains', title: 'Domains', dir: mdDomainsDir() },
    { id: 'entities', title: 'Entities', dir: mdEntitiesDir() },
    { id: 'concepts', title: 'Concepts', dir: mdConceptsDir() },
  ];
  const sections: LibrarySection[] = [];
  for (const def of defs) {
    const files = (await listFiles(def.dir)).filter((f) => f.endsWith('.md')).sort();
    const pages = await Promise.all(files.map((file) => readLibraryPage(def.dir, def.id, file)));
    for (const page of pages) {
      const items = counts?.get(`${def.id}/${page.name}`);
      if (items !== undefined) page.items = items;
    }
    sections.push({ ...def, pages });
  }
  return sections;
}

/** Latest daily reviews, newest first — the library's time axis. */
async function recentDailyDigests(limit = 5): Promise<LibraryPage[]> {
  const dir = path.join(mdDir(), 'daily');
  const files = (await listFiles(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse().slice(0, limit);
  return Promise.all(files.map((file) => readLibraryPage(dir, 'daily', file)));
}

/** First sentence of the config's Purpose section, for the index preamble. */
function purposeLine(guidance: string | undefined): string {
  const purpose = /Purpose:\n([\s\S]*?)(?:\n\n|$)/.exec(guidance ?? '')?.[1]?.replace(/\s+/g, ' ').trim();
  if (!purpose) return 'Auto-generated knowledge base compiled from every synced source.';
  const sentence = purpose.split(/(?<=\.)\s/)[0] ?? purpose;
  return sentence.length > 320 ? `${sentence.slice(0, 319).trimEnd()}…` : sentence;
}

function byUpdatedDesc(a: LibraryPage, b: LibraryPage): number {
  return b.mtimeMs - a.mtimeMs;
}

function byDepthDesc(a: LibraryPage, b: LibraryPage): number {
  return (b.items ?? b.sampled) - (a.items ?? a.sampled) || a.name.localeCompare(b.name);
}

/**
 * Prefer the canonical item count; fall back to the prompt sample size, labelled
 * as a sample, because "50 sources" on every page reads like a real total when
 * it is really MAX_SAMPLE_SIZE.
 */
function depthLabel(page: LibraryPage): string {
  if (page.items !== undefined) return `${page.items} items`;
  return page.sampled ? `${page.sampled} sampled` : '';
}

/** Newest pages, capped per section so one rebuilt directory cannot fill the list. */
function recentAcrossSections(sections: LibrarySection[], limit: number, perSection: number): LibraryPage[] {
  const taken = new Map<string, number>();
  const picked: LibraryPage[] = [];
  for (const page of sections.flatMap((section) => section.pages).sort(byUpdatedDesc)) {
    const key = page.rel.split('/')[0];
    const used = taken.get(key) ?? 0;
    if (used >= perSection) continue;
    taken.set(key, used + 1);
    picked.push(page);
    if (picked.length >= limit) break;
  }
  return picked;
}

/**
 * index.md is a navigation surface, not a file listing: the entry points come
 * first (biggest pages, newest reviews, config), then the full catalog. Domain
 * pages are the long tail, so past 40 they collapse into a compact line.
 */
/**
 * `--only` accepts either exact page keys ("entities/karpathy") or a whole page
 * type ("entities"). Type selection matters because the X-only and unified
 * compilers write into the same directories: refreshing entity pages must not
 * overwrite category and domain pages that the unified run produced.
 */
interface OnlyFilter {
  matches(key: string): boolean;
}

function buildOnlyFilter(only: string[] | undefined): OnlyFilter | null {
  const entries = (only ?? []).flatMap((entry) => entry.split(',')).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return null;
  const keys = new Set(entries.filter((entry) => entry.includes('/')));
  const types = new Set(entries.filter((entry) => !entry.includes('/')).map((entry) => entry.replace(/\/$/, '')));
  return {
    matches(key: string): boolean {
      if (keys.has(key)) return true;
      const type = key.split('/')[0];
      return types.has(type);
    },
  };
}

async function generateIndex(): Promise<string> {
  const counts = await libraryItemCounts();
  const sections = await collectLibrarySections(counts);
  const guidance = await readWikiGuidance();
  const daily = await recentDailyDigests();
  const allPages = sections.flatMap((section) => section.pages);
  const now = new Date().toISOString().slice(0, 10);
  const wikilink = (page: LibraryPage): string => `[[${page.rel.replace(/\.md$/, '')}]]`;

  const lines: string[] = [
    '---',
    'tags: [ft/index]',
    `last_updated: ${now}`,
    `pages: ${allPages.length}`,
    '---',
    '',
    '# Field Theory Library',
    '',
    purposeLine(guidance),
    '',
    `${allPages.length} generated pages across ${sections.filter((section) => section.pages.length > 0).length} page types. Navigation surface — edit \`wiki.config.md\`, not this file.`,
    '',
    '## Start here',
    '',
  ];

  const sourcePages = sections.find((section) => section.id === 'sources')?.pages ?? [];
  if (sourcePages.length > 0) {
    lines.push(`- **Sources:** ${[...sourcePages].sort(byDepthDesc).map(wikilink).join(' · ')}`);
  }
  const deepest = allPages
    .filter((page) => !page.rel.startsWith('sources/') && (page.items ?? 0) > 0)
    .sort(byDepthDesc)
    .slice(0, 8);
  if (deepest.length > 0) {
    lines.push(`- **Deepest pages:** ${deepest.map((page) => `${wikilink(page)} (${page.items})`).join(' · ')}`);
  }
  if (daily.length > 0) {
    lines.push(`- **Latest reviews:** ${daily.map((page) => `[${page.name}](daily/${page.name}.md)`).join(' · ')}`);
  }
  lines.push('- **Config:** [[wiki.config]] — purpose, audience, and style rules used when pages are written.');
  lines.push('- **Search:** `ft research <topic>` for cross-source hits; `ft ask <question>` to read these pages.');
  lines.push('');

  const recent = recentAcrossSections(sections, 10, 4);
  if (recent.length > 0) {
    lines.push('## Recently updated');
    lines.push('');
    for (const page of recent) {
      const depth = depthLabel(page);
      lines.push(`- ${wikilink(page)}${page.updated ? ` — ${page.updated}` : ''}${depth ? ` · ${depth}` : ''}`);
    }
    lines.push('');
  }

  lines.push('## Catalog');
  lines.push('');
  for (const section of sections) {
    if (section.pages.length === 0) continue;
    lines.push(`### ${section.title} (${section.pages.length})`);
    lines.push('');
    if (section.pages.length > 40) {
      // A 200-line list of one-word domain pages is noise; keep it scannable.
      lines.push(section.pages.map(wikilink).join(' · '));
    } else {
      for (const page of section.pages) {
        const depth = depthLabel(page);
        lines.push(`- ${wikilink(page)}${depth ? ` — ${depth}` : ''}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Rewrite index.md + index.html from what is on disk. Cheap and LLM-free, so
 * callers can refresh navigation without regenerating page content.
 */
export async function regenerateLibraryIndexes(): Promise<{ indexPath: string; htmlPath: string; pages: number }> {
  await ensureWikiConfig();
  const indexContent = await generateIndex();
  await writeMd(mdIndexPath(), indexContent);
  const htmlContent = await generateHtmlIndex();
  await writeMd(mdHtmlPath(), htmlContent);
  const pages = Number(/^pages:\s*(\d+)$/m.exec(indexContent)?.[1] ?? 0);
  return { indexPath: mdIndexPath(), htmlPath: mdHtmlPath(), pages };
}

/** Readable HTML entry point for the library, built on the shared page shell. */
async function generateHtmlIndex(): Promise<string> {
  const counts = await libraryItemCounts();
  const sections = await collectLibrarySections(counts);
  const guidance = await readWikiGuidance();
  const daily = await recentDailyDigests(7);
  const allPages = sections.flatMap((section) => section.pages);
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const toItem = (page: LibraryPage, group: string): HtmlItem => ({
    title: page.label,
    url: page.rel,
    eyebrow: group,
    byline: [depthLabel(page), page.updated ? `updated ${page.updated}` : '']
      .filter(Boolean)
      .join(' · '),
    group,
    openLabel: 'Markdown',
  });

  const chips: HtmlChip[] = [{ label: 'Everything' }];
  const groups: string[] = [];

  if (daily.length > 0) {
    chips.push({ label: 'Daily reviews', value: 'daily', count: daily.length });
    groups.push(renderHtmlGroup({
      label: 'Daily reviews',
      sublabel: 'Newest first',
      count: `${daily.length} shown`,
      intro: 'Each review has a readable HTML page beside its markdown.',
      items: daily.map((page) => ({
        title: page.name,
        url: `daily/${page.name}.html`,
        eyebrow: 'daily',
        byline: 'HTML page · markdown beside it',
        group: 'daily',
        openLabel: 'Open page',
      })),
      group: 'daily',
    }));
  }

  const recent = recentAcrossSections(sections, 8, 3);
  if (recent.length > 0) {
    chips.push({ label: 'Recently updated', value: 'recent', count: recent.length });
    groups.push(renderHtmlGroup({
      label: 'Recently updated',
      sublabel: 'Fresh pages',
      count: `${recent.length} pages`,
      items: recent.map((page) => toItem(page, 'recent')),
      group: 'recent',
    }));
  }

  for (const section of sections) {
    if (section.pages.length === 0) continue;
    const ordered = [...section.pages].sort(byDepthDesc);
    chips.push({ label: section.title, value: section.id, count: section.pages.length });
    groups.push(renderHtmlGroup({
      label: section.title,
      sublabel: `${section.pages.length} pages`,
      count: 'by depth',
      items: ordered.map((page) => toItem(page, section.id)),
      group: section.id,
    }));
  }

  return renderHtmlPage({
    title: 'Field Theory Library',
    subtitle: purposeLine(guidance),
    stats: [
      { label: 'Pages', value: allPages.length },
      ...sections.filter((section) => section.pages.length > 0).map((section) => ({
        label: section.title,
        value: section.pages.length,
      })),
    ],
    metaLine: `Rebuilt <b>${htmlEscape(now)}</b> UTC by <code>ft md</code> · page style comes from <code>wiki.config.md</code>`,
    chips,
    searchPlaceholder: 'Search page names',
    body: groups.join(''),
    footer: 'Links open the generated markdown; daily reviews open their HTML page. Run <code>ft wiki --unified</code> to refresh page content.',
  });
}

/** Grep-friendly log entry: `## [YYYY-MM-DD] type | detail` */
export function logEntry(type: string, detail: string): string {
  const ts = new Date().toISOString().slice(0, 10);
  return `## [${ts}] ${type} | ${detail}`;
}

/** Short log label from an EngineInvocationError reason. */
function reasonLabel(reason: EngineInvocationError['reason']): string {
  switch (reason) {
    case 'timeout':   return 'TIMEOUT';
    case 'maxbuffer': return 'OVERFLOW';
    case 'spawn':     return 'SPAWN-FAIL';
    case 'exit':      return 'ERROR';
  }
}

/** Build the log detail from a structured engine failure. Prefers stderr,
 *  falls back to the reason-shaped message — never the raw prompt. */
function formatFailureDetail(err: EngineInvocationError): string {
  // For spawn failures (ENOENT etc) the message IS the useful content.
  if (err.reason === 'spawn') return err.message;
  const stderrLine = err.stderr.trim().split(/\r?\n/).filter(Boolean).pop();
  if (stderrLine) {
    return err.reason === 'timeout'
      ? `${err.message} [stderr: ${stderrLine}]`
      : stderrLine;
  }
  return err.message;
}

/** Reason-aware advice line shown when the breaker fires. */
function engineFailureHint(engineName: string, err: EngineInvocationError | null): string {
  if (err?.reason === 'timeout') {
    return `${engineName} ran to the full timeout on every page — usually a hung child, not auth. ` +
           `Upgrade ${engineName} (\`${engineName} --version\`) and retry with \`ft wiki\`.`;
  }
  if (err?.reason === 'spawn') {
    return `Could not spawn \`${engineName}\`. Check that it's installed and on PATH, then rerun \`ft wiki\`.`;
  }
  if (err?.stderr && /rate.?limit|quota|429/i.test(err.stderr)) {
    return `${engineName} is rate-limited. Wait a bit, then rerun \`ft wiki\`.`;
  }
  if (err?.stderr && /auth|login|unauthor|invalid.*token|expired/i.test(err.stderr)) {
    return `${engineName} reports an auth problem — re-authenticate (e.g. \`${engineName} /login\`) and rerun \`ft wiki\`.`;
  }
  return `Check that \`${engineName}\` is authenticated and not rate-limited, then rerun \`ft wiki\`.`;
}

export async function compileMd(options: CompileOptions = {}): Promise<CompileResult> {
  const progress  = options.onProgress ?? ((s: string) => fs.writeSync(2, s + '\n'));
  const startTime = Date.now();
  const onlyFilter = buildOnlyFilter(options.only);

  // ── Lock file to prevent concurrent runs ──────────────────────────────
  const lockPath = path.join(mdDir(), '.lock');
  await ensureDir(mdDir());
  try {
    fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
  } catch {
    const existingPid = fs.readFileSync(lockPath, 'utf8').trim();
    let alive = false;
    try { process.kill(Number(existingPid), 0); alive = true; } catch { /* not running */ }
    if (alive) {
      throw new Error(`Another ft wiki is already running (pid ${existingPid}). Wait for it to finish or remove ${lockPath}`);
    }
    // Stale lock from a crashed run — take over
    fs.writeFileSync(lockPath, String(process.pid));
  }

  try {
    return await doCompile(options, progress, startTime, onlyFilter);
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* best effort */ }
  }
}

async function doCompileUnified(
  options: CompileOptions,
  progress: (s: string) => void,
  startTime: number,
  onlySet: OnlyFilter | null,
  engine: ResolvedEngine,
  state: MdState,
  isFullCompile: boolean,
): Promise<CompileResult> {
  let pagesCreated = 0;
  let pagesUpdated = 0;
  let pagesSkipped = 0;
  let pagesFailed = 0;
  let aborted = false;

  // ── Scan all groups from canonical tables ───────────────────────────
  progress('Scanning canonical bookmarks...');
  const categoryCounts = await getCanonicalCategoryCounts();
  const domainCounts = await getCanonicalDomainCounts();
  const sourceCounts = await getCanonicalSourceCounts();

  interface UnifiedWorkItem {
    key: string;
    type: 'source' | 'category' | 'domain';
    name: string;
    count: number;
  }
  const toGenerate: UnifiedWorkItem[] = [];
  let skipCount = 0;

  // Source pages — one per source, including X people and X-list members.
  for (const [source, count] of Object.entries(sourceCounts)) {
    if (count < 1) continue;
    const key = `sources/${source}`;
    if (onlySet && !onlySet.matches(key)) continue;
    if (!isFullCompile && !onlySet && !hasChanged(state, key, count)) { skipCount++; continue; }
    toGenerate.push({ key, type: 'source', name: source, count });
  }

  for (const [category, count] of Object.entries(categoryCounts)) {
    if (count < MIN_CATEGORY_COUNT) continue;
    const key = `categories/${category}`;
    if (onlySet && !onlySet.matches(key)) continue;
    if (!isFullCompile && !onlySet && !hasChanged(state, key, count)) { skipCount++; continue; }
    toGenerate.push({ key, type: 'category', name: category, count });
  }

  for (const [domain, count] of Object.entries(domainCounts)) {
    if (count < MIN_DOMAIN_COUNT) continue;
    const key = `domains/${domain}`;
    if (onlySet && !onlySet.matches(key)) continue;
    if (!isFullCompile && !onlySet && !hasChanged(state, key, count)) { skipCount++; continue; }
    toGenerate.push({ key, type: 'domain', name: domain, count });
  }

  pagesSkipped = skipCount;

  const logLine = async (msg: string): Promise<void> => {
    progress(msg);
    try { await appendLine(mdLogPath(), logEntry('compile', msg)); } catch { /* best effort */ }
  };

  if (toGenerate.length === 0) {
    progress('Nothing to compile — all pages up to date.');
  } else {
    const est = toGenerate.length > 3 ? ` (~${toGenerate.length}–${toGenerate.length * 2} min)` : '';
    progress(`\nGenerating ${toGenerate.length} unified pages with ${engine.name}${est}`);
    if (skipCount > 0) progress(`  ${skipCount} pages unchanged, skipping`);
    progress(`  Follow live: tail -f ${mdLogPath()}`);
    progress('');
    await appendLine(
      mdLogPath(),
      logEntry('compile', `start unified — ${toGenerate.length} pages, engine=${engine.name}`),
    );
  }

  // ── Generate each page ───────────────────────────────────────────────
  // The library owner's own instructions ride along with every page prompt.
  await ensureWikiConfig();
  const guidance = await readWikiGuidance();
  let consecutiveFailures = 0;
  let firstFailureMsg = '';
  for (let i = 0; i < toGenerate.length; i++) {
    const item = toGenerate[i];
    const tag = `[${i + 1}/${toGenerate.length}]`;

    let samples: CanonicalSample[];
    let prompt: string;
    if (item.type === 'source') {
      samples = await sampleCanonicalBySource(item.name, MAX_SAMPLE_SIZE);
      prompt = buildSourcePagePrompt(item.name, mapCanonicalToMdBookmarks(samples), guidance);
    } else if (item.type === 'category') {
      samples = await sampleCanonicalByCategory(item.name, MAX_SAMPLE_SIZE);
      prompt = buildCategoryPagePrompt(item.name, mapCanonicalToMdBookmarks(samples), guidance);
    } else {
      samples = await sampleCanonicalByDomain(item.name, MAX_SAMPLE_SIZE);
      prompt = buildDomainPagePrompt(item.name, mapCanonicalToMdBookmarks(samples), guidance);
    }

    const opts = llmOpts(samples.length);
    await logLine(`${tag} ${item.key} (${samples.length} sampled, ${Math.round(opts.timeout / 1000)}s timeout)...`);

    let content: string;
    try {
      const raw = await invokeEngineAsync(engine, prompt, opts);
      content = stripLlmMarkdownFence(raw);
    } catch (err) {
      const eie = err instanceof EngineInvocationError ? err : null;
      const label = eie ? reasonLabel(eie.reason) : 'ERROR';
      const detail = eie ? formatFailureDetail(eie) : (err as Error).message ?? String(err);
      await logLine(`${tag} ${item.key} — ${label}: ${detail.slice(0, 200)}`);
      pagesFailed++;
      consecutiveFailures++;
      if (!firstFailureMsg) firstFailureMsg = eie?.message ?? (err as Error).message ?? String(err);
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        aborted = true;
        await logLine(
          `Aborted after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — first error: ${firstFailureMsg.slice(0, 300)}`,
        );
        await logLine(engineFailureHint(engine.name, eie));
        break;
      }
      continue;
    }

    const dirFn = item.type === 'source' ? mdSourcesDir
      : item.type === 'category' ? mdCategoriesDir : mdDomainsDir;
    const filePath = path.join(dirFn(), `${slug(item.name)}.md`);
    const relPath = `${item.type === 'source' ? 'sources' : item.type === 'category' ? 'categories' : 'domains'}/${slug(item.name)}.md`;
    const outcome = await writePage(filePath, content, state, relPath);
    state.groupCounts[item.key] = String(item.count);

    if (outcome === 'created') pagesCreated++;
    else if (outcome === 'updated') pagesUpdated++;
    else pagesSkipped++;

    await writeJson(mdStatePath(), state);
    await logLine(`${tag} ${item.key} → ${outcome}`);
    consecutiveFailures = 0;
  }

  // ── Index ─────────────────────────────────────────────────────────────
  progress('Regenerating index.md...');
  const indexContent = await generateIndex();
  await writeMd(mdIndexPath(), indexContent);

  progress('Generating index.html...');
  const htmlContent = await generateHtmlIndex();
  await writeMd(mdHtmlPath(), htmlContent);

  // ── Log + state ───────────────────────────────────────────────────────
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const totalPages = pagesCreated + pagesUpdated;
  await appendLine(
    mdLogPath(),
    logEntry('compile', `${aborted ? 'aborted ' : ''}unified engine=${engine.name} created=${pagesCreated} updated=${pagesUpdated} skipped=${pagesSkipped} failed=${pagesFailed} elapsed=${elapsed}s`),
  );

  state.lastCompileAt = new Date().toISOString();
  state.totalCompiles = (state.totalCompiles ?? 0) + 1;
  await writeJson(mdStatePath(), state);

  return { engine: engine.name, pagesCreated, pagesUpdated, pagesSkipped, pagesFailed, totalPages, elapsed, aborted };
}

async function doCompile(
  options: CompileOptions,
  progress: (s: string) => void,
  startTime: number,
  onlySet: OnlyFilter | null,
): Promise<CompileResult> {
  const engine = await resolveEngine({
    override: options.engineOverride,
    model: options.modelOverride,
    effort: options.effortOverride,
  });
  progress(`Using ${engine.name}`);

  progress('Initializing md directories...');
  await ensureDir(mdDir());
  await ensureDir(mdCategoriesDir());
  await ensureDir(mdDomainsDir());
  await ensureDir(mdEntitiesDir());
  await ensureDir(mdConceptsDir());
  await ensureDir(mdSourcesDir());

  await generateSchemaIfMissing();

  const state = await loadMdState();
  const isFullCompile = Boolean(options.full);

  if (options.unified) {
    return await doCompileUnified(options, progress, startTime, onlySet, engine, state, isFullCompile);
  }

  let pagesCreated = 0;
  let pagesUpdated = 0;
  let pagesSkipped = 0;
  let pagesFailed  = 0;
  let aborted      = false;

  const db = await openBookmarksDb();

  try {
    // ── Scan all groups up front so we can show a plan ───────────────────
    progress('Scanning bookmarks...');
    const categoryCounts = await getCategoryCounts(db);
    const domainCounts   = await getDomainCounts(db);
    const topAuthors     = await getTopAuthorHandles(MIN_ENTITY_COUNT, db);

    // Build the work queue: everything that needs an LLM call
    interface WorkItem {
      key: string;
      type: 'category' | 'domain' | 'entity';
      name: string;
      count: number;
    }
    const toGenerate: WorkItem[] = [];
    let skipCount = 0;

    for (const [category, count] of Object.entries(categoryCounts)) {
      if (count < MIN_CATEGORY_COUNT) continue;
      const key = `categories/${category}`;
      if (onlySet && !onlySet.matches(key)) continue;
      if (!isFullCompile && !onlySet && !hasChanged(state, key, count)) { skipCount++; continue; }
      toGenerate.push({ key, type: 'category', name: category, count });
    }

    for (const [domain, count] of Object.entries(domainCounts)) {
      if (count < MIN_DOMAIN_COUNT) continue;
      const key = `domains/${domain}`;
      if (onlySet && !onlySet.matches(key)) continue;
      if (!isFullCompile && !onlySet && !hasChanged(state, key, count)) { skipCount++; continue; }
      toGenerate.push({ key, type: 'domain', name: domain, count });
    }

    for (const { handle, count } of topAuthors) {
      const key = `entities/${handle}`;
      if (onlySet && !onlySet.matches(key)) continue;
      if (!isFullCompile && !onlySet && !hasChanged(state, key, count)) { skipCount++; continue; }
      toGenerate.push({ key, type: 'entity', name: handle, count });
    }

    pagesSkipped = skipCount;

    // Per-event line: echo to the terminal and append to log.md so the
    // user can `tail -f` the log from another shell while a compile runs.
    const logLine = async (msg: string): Promise<void> => {
      progress(msg);
      try { await appendLine(mdLogPath(), logEntry('compile', msg)); } catch { /* best effort */ }
    };

    if (toGenerate.length === 0) {
      progress('Nothing to compile — all pages up to date.');
    } else {
      const est = toGenerate.length > 3 ? ` (~${toGenerate.length}–${toGenerate.length * 2} min)` : '';
      progress(`\nGenerating ${toGenerate.length} pages with ${engine.name}${est}`);
      if (skipCount > 0) progress(`  ${skipCount} pages unchanged, skipping`);
      progress(`  Follow live: tail -f ${mdLogPath()}`);
      progress('');
      await appendLine(
        mdLogPath(),
        logEntry('compile', `start — ${toGenerate.length} pages, engine=${engine.name}`),
      );
    }

    // ── Generate each page ───────────────────────────────────────────────
    await ensureWikiConfig();
    const guidance = await readWikiGuidance();
    let consecutiveFailures = 0;
    let firstFailureMsg = '';
    for (let i = 0; i < toGenerate.length; i++) {
      const item = toGenerate[i];
      const tag = `[${i + 1}/${toGenerate.length}]`;

      let samples: CategorySample[];
      let prompt: string;
      if (item.type === 'category') {
        samples = await sampleByCategory(item.name, MAX_SAMPLE_SIZE, db);
        prompt  = buildCategoryPagePrompt(item.name, mapToMdBookmarks(samples), guidance);
      } else if (item.type === 'domain') {
        samples = await sampleByDomain(item.name, MAX_SAMPLE_SIZE, db);
        prompt  = buildDomainPagePrompt(item.name, mapToMdBookmarks(samples), guidance);
      } else {
        samples = await sampleByAuthor(item.name, MAX_SAMPLE_SIZE, db);
        prompt  = buildEntityPagePrompt(item.name, mapToMdBookmarks(samples), guidance);
      }

      const opts = llmOpts(samples.length);
      await logLine(`${tag} ${item.key} (${samples.length} sampled, ${Math.round(opts.timeout / 1000)}s timeout)...`);

      let content: string;
      try {
        const raw = await invokeEngineAsync(engine, prompt, opts);
        content = stripLlmMarkdownFence(raw);
      } catch (err) {
        // Prefer the structured EngineInvocationError fields over err.message.
        // err.message used to be the execFile-formatted "Command failed: claude
        // -p --output-format text <FULL PROMPT>", which consumed the entire
        // log budget with prompt bytes and hid the real signal. We now log a
        // short label derived from the failure reason plus the tail of stderr,
        // which is usually where claude/codex put "auth expired" / "rate limit"
        // / "model not available".
        const eie = err instanceof EngineInvocationError ? err : null;
        const label = eie ? reasonLabel(eie.reason) : 'ERROR';
        const detail = eie ? formatFailureDetail(eie) : (err as Error).message ?? String(err);
        await logLine(`${tag} ${item.key} — ${label}: ${detail.slice(0, 200)}`);
        pagesFailed++;
        consecutiveFailures++;
        if (!firstFailureMsg) firstFailureMsg = eie?.message ?? (err as Error).message ?? String(err);
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          aborted = true;
          await logLine(
            `Aborted after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — first error: ${firstFailureMsg.slice(0, 300)}`,
          );
          await logLine(engineFailureHint(engine.name, eie));
          break;
        }
        continue;
      }

      const dirFn = item.type === 'category' ? mdCategoriesDir
        : item.type === 'domain' ? mdDomainsDir : mdEntitiesDir;
      const filePath = path.join(dirFn(), `${slug(item.name)}.md`);
      const relPath  = `${item.type === 'category' ? 'categories' : item.type === 'domain' ? 'domains' : 'entities'}/${slug(item.name)}.md`;
      const outcome  = await writePage(filePath, content, state, relPath);
      state.groupCounts[item.key] = String(item.count);

      if (outcome === 'created') pagesCreated++;
      else if (outcome === 'updated') pagesUpdated++;
      else pagesSkipped++;

      // Save state after each page so Ctrl-C resumes where we left off
      await writeJson(mdStatePath(), state);

      await logLine(`${tag} ${item.key} → ${outcome}`);
      consecutiveFailures = 0;
    }
  } finally {
    db.close();
  }

  // ── Index ───────────────────────────────────────────────────────────────
  progress('Regenerating index.md...');
  const indexContent = await generateIndex();
  await writeMd(mdIndexPath(), indexContent);

  progress('Generating index.html...');
  const htmlContent = await generateHtmlIndex();
  await writeMd(mdHtmlPath(), htmlContent);

  // ── Log entry ───────────────────────────────────────────────────────────
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const totalPages = pagesCreated + pagesUpdated;
  await appendLine(
    mdLogPath(),
    logEntry('compile', `${aborted ? 'aborted ' : ''}engine=${engine.name} created=${pagesCreated} updated=${pagesUpdated} skipped=${pagesSkipped} failed=${pagesFailed} elapsed=${elapsed}s`),
  );

  // ── Save state ───────────────────────────────────────────────────────────
  state.lastCompileAt  = new Date().toISOString();
  state.totalCompiles  = (state.totalCompiles ?? 0) + 1;
  await writeJson(mdStatePath(), state);

  return { engine: engine.name, pagesCreated, pagesUpdated, pagesSkipped, pagesFailed, totalPages, elapsed, aborted };
}
