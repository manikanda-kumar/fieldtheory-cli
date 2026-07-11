import type { CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import type { Database } from 'sql.js';
import { acquireDbLock, openDb, releaseDbLock, saveDb } from '../db.js';
import { twitterBookmarksIndexPath } from '../paths.js';
import { createOpenCodeClient, openCodeApiKey } from '../llm/opencode-client.js';
import { THIN_CONTENT_CHARS, contentLength } from './synthesize.js';

const FAILED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const BODY_LIMIT_BYTES = 200_000;
const DEFAULT_LIMIT = 25;
const BACKFILL_DEFAULT_CONCURRENCY = 2;
const DAILY_DEFAULT_CONCURRENCY = 4;

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface LinkEnrichmentEntry {
  url: string;
  summary: string | null;
  status: 'ok' | 'failed';
  enrichedAt: string;
  error: string | null;
}

export interface EnrichThinItemsOptions {
  fetch?: FetchFn;
  llm?: (prompt: string) => Promise<string>;
  limit?: number;
  now?: Date;
  onMissingKey?: () => void;
}

export interface EnrichThinItemsResult {
  /** Items with a usable cached or newly generated summary in this digest. */
  enrichedCount: number;
  summaries: Map<string, string>;
}

export interface EnrichmentBackfillResult {
  eligible: number;
  pending: number;
  attempted: number;
  ok: number;
  failed: number;
  skippedCached: number;
  errorKinds: Array<{ error: string; count: number }>;
}

export interface EnrichBackfillOptions extends EnrichThinItemsOptions {
  all?: boolean;
  dryRun?: boolean;
  retryFailed?: boolean;
  concurrency?: number;
  onProgress?: (result: Pick<EnrichmentBackfillResult, 'attempted' | 'ok' | 'failed'>) => void;
}

/** Fetch/cache summaries for otherwise-thin daily items. This function never throws. */
export async function enrichThinItems(items: CanonicalRecentItem[], options: EnrichThinItemsOptions = {}): Promise<EnrichThinItemsResult> {
  const eligible = items.filter((item) => isEligible(item));
  if (eligible.length === 0) return { enrichedCount: 0, summaries: new Map() };
  if (!options.llm && !openCodeApiKey()) {
    options.onMissingKey?.();
    return { enrichedCount: 0, summaries: new Map() };
  }

  try {
    const now = options.now ?? new Date();
    await ensureEnrichmentSchema();
    const cached = await readCache([...new Set(eligible.map((item) => item.canonicalUrl!))]);
    await enrichEligibleItems(eligible, cached, options, now, parseLimit(options.limit), undefined, DAILY_DEFAULT_CONCURRENCY);
    const finalSummaries = usableSummaries(eligible, cached);
    return { enrichedCount: finalSummaries.size, summaries: finalSummaries };
  } catch {
    return { enrichedCount: 0, summaries: new Map() };
  }
}

/** Enrich every eligible canonical row, while retaining the daily flow's fetch/cache core. */
export async function enrichBackfill(options: EnrichBackfillOptions = {}): Promise<EnrichmentBackfillResult> {
  const items = await readCanonicalItems();
  const eligible = items.filter(isEligible);
  await ensureEnrichmentSchema();
  await removeNowIneligibleFailures(items);
  const now = options.now ?? new Date();
  const cached = await readCache([...new Set(eligible.map((item) => item.canonicalUrl!))]);
  const pending = eligible.filter((item) => shouldAttempt(item.canonicalUrl!, cached.get(item.canonicalUrl!), now, options.retryFailed));
  const skippedCached = eligible.filter((item) => {
    const entry = cached.get(item.canonicalUrl!);
    return entry?.status === 'ok' && Boolean(entry.summary?.trim());
  }).length;
  const base = { eligible: eligible.length, pending: pending.length, attempted: 0, ok: 0, failed: 0, skippedCached, errorKinds: [] };
  if (options.dryRun || pending.length === 0) return base;
  if (!options.llm && !openCodeApiKey()) {
    options.onMissingKey?.();
    return base;
  }
  const limit = options.all ? Number.POSITIVE_INFINITY : parseLimit(options.limit ?? 100);
  const updates = await enrichEligibleItems(eligible, cached, options, now, limit, options.onProgress, options.concurrency ?? BACKFILL_DEFAULT_CONCURRENCY, options.retryFailed);
  return {
    ...base,
    attempted: updates.length,
    ok: updates.filter((entry) => entry.status === 'ok').length,
    failed: updates.filter((entry) => entry.status === 'failed').length,
    errorKinds: topErrorKinds(updates),
  };
}

/** Append summaries to only the current collection's in-memory search text. */
export function mergeEnrichmentSummaries(items: CanonicalRecentItem[], summaries: Map<string, string>): void {
  for (const item of items) {
    const summary = item.canonicalUrl ? summaries.get(item.canonicalUrl) : undefined;
    if (summary && !item.searchText.includes(` summary: ${summary}`)) item.searchText = `${item.searchText} summary: ${summary}`.trim();
  }
}

export function isEnrichmentEligible(item: CanonicalRecentItem): boolean {
  if (contentLength(item.searchText) >= THIN_CONTENT_CHARS || !item.canonicalUrl) return false;
  try {
    const url = new URL(item.canonicalUrl);
    // Exclude auth-walled X/Twitter, video-only YouTube, PDFs, and existing non-web/long-content cases.
    return (url.protocol === 'http:' || url.protocol === 'https:') && !isExcludedEnrichmentUrl(url);
  } catch {
    return false;
  }
}

const isEligible = isEnrichmentEligible;

function isExcludedEnrichmentUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return /(^|\.)(x|twitter)\.com$/.test(host) || /(^|\.)(youtube\.com|youtu\.be)$/.test(host) || /\.pdf$/i.test(url.pathname);
}

function shouldAttempt(_url: string, cached: LinkEnrichmentEntry | undefined, now: Date, retryFailed = false): boolean {
  if (!cached) return true;
  if (cached.status === 'ok' && cached.summary?.trim()) return false;
  return (retryFailed && isTransientError(cached.error)) || !Number.isFinite(Date.parse(cached.enrichedAt)) || Date.parse(cached.enrichedAt) <= now.getTime() - FAILED_RETRY_MS;
}

function parseLimit(value: number | undefined): number {
  const raw = value ?? Number(process.env.FT_ENRICH_LIMIT ?? DEFAULT_LIMIT);
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : DEFAULT_LIMIT;
}

function usableSummaries(items: CanonicalRecentItem[], cache: Map<string, LinkEnrichmentEntry>, into = new Map<string, string>()): Map<string, string> {
  for (const item of items) {
    const entry = item.canonicalUrl ? cache.get(item.canonicalUrl) : undefined;
    if (item.canonicalUrl && entry?.status === 'ok' && entry.summary?.trim()) into.set(item.canonicalUrl, entry.summary.trim());
  }
  return into;
}

async function readCache(urls: string[]): Promise<Map<string, LinkEnrichmentEntry>> {
  if (urls.length === 0) return new Map();
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  try {
    let rows: unknown[][];
    try {
      rows = db.exec(`SELECT url, summary, status, enriched_at, error FROM link_enrichment WHERE url IN (${urls.map(() => '?').join(',')})`, urls)[0]?.values ?? [];
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
      rows = [];
    }
    return new Map(rows.map((row) => [String(row[0]), { url: String(row[0]), summary: row[1] == null ? null : String(row[1]), status: row[2] === 'ok' ? 'ok' : 'failed', enrichedAt: String(row[3] ?? ''), error: row[4] == null ? null : String(row[4]) }]));
  } finally {
    db.close();
  }
}

function isMissingTableError(error: unknown): boolean {
  return (error instanceof Error ? error.message : String(error)).toLowerCase().includes('no such table');
}

async function readCanonicalItems(): Promise<CanonicalRecentItem[]> {
  const db = await openDb(twitterBookmarksIndexPath());
  try {
    const rows = db.exec(`SELECT id, canonical_url, display_title, search_text, sources_json,
      first_saved_at, last_saved_at, primary_category, primary_domain FROM canonical_bookmarks`)[0]?.values ?? [];
    return rows.map((row) => ({
      id: String(row[0]), canonicalUrl: row[1] == null ? null : String(row[1]), displayTitle: row[2] == null ? null : String(row[2]),
      searchText: String(row[3] ?? ''), sources: parseSources(row[4]), firstSavedAt: row[5] == null ? null : String(row[5]),
      lastSavedAt: row[6] == null ? null : String(row[6]), primaryCategory: row[7] == null ? null : String(row[7]), primaryDomain: row[8] == null ? null : String(row[8]),
    }));
  } finally {
    db.close();
  }
}

async function enrichEligibleItems(
  eligible: CanonicalRecentItem[],
  cached: Map<string, LinkEnrichmentEntry>,
  options: EnrichThinItemsOptions,
  now: Date,
  limit: number,
  onProgress?: (result: { attempted: number; ok: number; failed: number }) => void,
  concurrency = DAILY_DEFAULT_CONCURRENCY,
  retryFailed = false,
): Promise<LinkEnrichmentEntry[]> {
  const misses = eligible.filter((item) => shouldAttempt(item.canonicalUrl!, cached.get(item.canonicalUrl!), now, retryFailed)).slice(0, limit);
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const llm = options.llm ?? (async (prompt: string) => (await createOpenCodeClient().chat({ prompt, maxTokens: 2000 })).text);
  let attempted = 0;
  let ok = 0;
  let failed = 0;
  const enrichOne = async (item: CanonicalRecentItem): Promise<LinkEnrichmentEntry> => {
    const url = item.canonicalUrl!;
    let update: LinkEnrichmentEntry;
    try {
      const material = await retryTransient('fetch', () => extractPageMaterial(url, fetchFn));
      await delay(250);
      const summary = await retryTransient('llm', async () => {
        const value = (await llm(buildEnrichmentPrompt(material))).trim();
        if (!value) throw new Error('empty completion');
        return value;
      });
      update = { url, summary, status: 'ok', enrichedAt: now.toISOString(), error: null };
    } catch (error) {
      update = { url, summary: null, status: 'failed', enrichedAt: now.toISOString(), error: formatFailure(error) };
    }
    attempted += 1;
    if (update.status === 'ok') ok += 1;
    else failed += 1;
    if (onProgress && attempted % 25 === 0) onProgress({ attempted, ok, failed });
    return update;
  };
  const updates: LinkEnrichmentEntry[] = [];
  for (let start = 0; start < misses.length; start += 50) {
    const batch = await mapConcurrent(misses.slice(start, start + 50), concurrency, enrichOne);
    await writeCache(batch);
    updates.push(...batch);
  }
  for (const update of updates) if (update.status === 'ok' && update.summary) cached.set(update.url, update);
  return updates;
}

function parseSources(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((source): source is string => typeof source === 'string') : [];
  } catch {
    return [];
  }
}

async function writeCache(entries: LinkEnrichmentEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const dbPath = twitterBookmarksIndexPath();
  const lock = await acquireDbLock(dbPath);
  const db = await openDb(dbPath);
  try {
    initEnrichmentSchema(db);
    const statement = db.prepare(`INSERT INTO link_enrichment (url, summary, status, enriched_at, error) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET summary = excluded.summary, status = excluded.status, enriched_at = excluded.enriched_at, error = excluded.error`);
    try {
      for (const entry of entries) statement.run([entry.url, entry.summary, entry.status, entry.enrichedAt, entry.error]);
    } finally {
      statement.free();
    }
    saveDb(db, dbPath);
  } finally {
    db.close();
    releaseDbLock(lock);
  }
}

function initEnrichmentSchema(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS link_enrichment (url TEXT PRIMARY KEY, summary TEXT, status TEXT NOT NULL, enriched_at TEXT NOT NULL, error TEXT)');
  try { db.run('ALTER TABLE link_enrichment ADD COLUMN error TEXT'); } catch (error) { if (!String(error).toLowerCase().includes('duplicate column')) throw error; }
}

async function ensureEnrichmentSchema(): Promise<void> {
  const dbPath = twitterBookmarksIndexPath();
  const lock = await acquireDbLock(dbPath);
  const db = await openDb(dbPath);
  try {
    initEnrichmentSchema(db);
    saveDb(db, dbPath);
  } finally {
    db.close();
    releaseDbLock(lock);
  }
}

async function removeNowIneligibleFailures(items: CanonicalRecentItem[]): Promise<void> {
  const urls = items.filter((item) => item.canonicalUrl && !isEligible(item)).map((item) => item.canonicalUrl!);
  if (!urls.length) return;
  const dbPath = twitterBookmarksIndexPath();
  const lock = await acquireDbLock(dbPath);
  const db = await openDb(dbPath);
  try {
    initEnrichmentSchema(db);
    for (let start = 0; start < urls.length; start += 500) {
      const batch = urls.slice(start, start + 500);
      db.run(`DELETE FROM link_enrichment WHERE status = 'failed' AND url IN (${batch.map(() => '?').join(',')})`, batch);
    }
    saveDb(db, dbPath);
  } finally {
    db.close();
    releaseDbLock(lock);
  }
}

function formatFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'empty completion' || message.endsWith(': empty completion')) return 'empty completion';
  const stage = message.startsWith('fetch:') || message.startsWith('llm:') ? '' : 'fetch: ';
  return `${stage}${message}`.slice(0, 500);
}

async function retryTransient<T>(stage: 'fetch' | 'llm', operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (attempt === 2 || !isTransientError(error)) throw new Error(`${stage}: ${errorMessage(error)}`);
      await delay((attempt === 0 ? 1_000 : 4_000) + Math.floor(Math.random() * 250));
    }
  }
  throw lastError;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function isTransientError(error: unknown): boolean {
  const message = (typeof error === 'string' ? error : errorMessage(error)).toLowerCase();
  return /\b429\b|\b5\d\d\b|econnreset|etimedout|eai_again|aborted|aborterror|network|fetch failed|timed out|empty completion/.test(message);
}

function topErrorKinds(entries: LinkEnrichmentEntry[]): Array<{ error: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) if (entry.status === 'failed' && entry.error) counts.set(entry.error, (counts.get(entry.error) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([error, count]) => ({ error, count }));
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function extractPageMaterial(url: string, fetchFn: FetchFn): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    let current = assertSafeFetchUrl(url);
    let response: Response | undefined;
    // DNS rebinding protection is out of scope: validate hostname/IP literals
    // before each request, while manual redirects prevent bypassing that check.
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      response = await fetchFn(current, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FieldTheoryDigest/1.0)' } });
      if (!isRedirect(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location || redirects === 5) throw new Error('unsafe or excessive redirect');
      current = assertSafeFetchUrl(new URL(location, current).toString());
    }
    if (!response) throw new Error('no response');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await readLimitedBody(response, BODY_LIMIT_BYTES);
    const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = firstMatch(html, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)
      ?? firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i);
    const visible = decodeHtml(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 1200);
    return [`URL: ${url}`, title && `Title: ${decodeHtml(title)}`, description && `Description: ${decodeHtml(description)}`, visible && `Text: ${visible}`].filter(Boolean).join('\n');
  } finally {
    clearTimeout(timer);
  }
}

function buildEnrichmentPrompt(material: string): string {
  return `For a personal knowledge digest, summarize what this page is about in 2-3 plain sentences. No preamble.\n\n${material}`;
}

async function readLimitedBody(response: Response, limit: number): Promise<string> {
  // A no-body response has no bytes to read; never fall back to response.text(),
  // which may buffer an unbounded body in nonstandard fetch implementations.
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - size;
      chunks.push(value.byteLength > remaining ? value.slice(0, remaining) : value);
      size += Math.min(value.byteLength, remaining);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(all);
}

function assertSafeFetchUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported URL scheme');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.local') || isPrivateIpLiteral(hostname)) {
    throw new Error('unsafe fetch host');
  }
  return url.toString();
}

function isPrivateIpLiteral(hostname: string): boolean {
  const octets = hostname.split('.');
  if (octets.length === 4 && octets.every((part) => /^\d+$/.test(part) && Number(part) <= 255)) {
    const [a, b] = octets.map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return hostname === '::' || hostname === '::1' || /^[fcfd][0-9a-f]{1,3}:/i.test(hostname);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function firstMatch(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.[1]?.trim() || null;
}

function decodeHtml(text: string): string {
  return text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      results.push(await fn(item));
    }
  }));
  return results;
}
