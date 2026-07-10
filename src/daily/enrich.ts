import type { CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import type { Database } from 'sql.js';
import { openDb, saveDb } from '../db.js';
import { twitterBookmarksIndexPath } from '../paths.js';
import { createOpenCodeClient, openCodeApiKey } from '../llm/opencode-client.js';
import { THIN_CONTENT_CHARS, contentLength } from './synthesize.js';

const FAILED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const BODY_LIMIT_BYTES = 200_000;
const DEFAULT_LIMIT = 25;

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface LinkEnrichmentEntry {
  url: string;
  summary: string | null;
  status: 'ok' | 'failed';
  enrichedAt: string;
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
    const cached = await readCache([...new Set(eligible.map((item) => item.canonicalUrl!))]);
    const summaries = usableSummaries(eligible, cached);
    const limit = parseLimit(options.limit);
    const misses = eligible.filter((item) => shouldAttempt(item.canonicalUrl!, cached.get(item.canonicalUrl!), now)).slice(0, limit);
    const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    const llm = options.llm ?? (async (prompt: string) => (await createOpenCodeClient().chat({ prompt, maxTokens: 2000 })).text);
    const updates = await mapConcurrent(misses, 4, async (item): Promise<LinkEnrichmentEntry> => {
      const url = item.canonicalUrl!;
      try {
        const material = await extractPageMaterial(url, fetchFn);
        const summary = (await llm(buildEnrichmentPrompt(material))).trim();
        if (!summary) throw new Error('empty enrichment completion');
        return { url, summary, status: 'ok', enrichedAt: now.toISOString() };
      } catch {
        return { url, summary: null, status: 'failed', enrichedAt: now.toISOString() };
      }
    });
    if (updates.length) await writeCache(updates);
    for (const update of updates) if (update.status === 'ok' && update.summary) cached.set(update.url, update);
    const finalSummaries = usableSummaries(eligible, cached);
    return { enrichedCount: finalSummaries.size, summaries: finalSummaries };
  } catch {
    return { enrichedCount: 0, summaries: new Map() };
  }
}

/** Append summaries to only the current collection's in-memory search text. */
export function mergeEnrichmentSummaries(items: CanonicalRecentItem[], summaries: Map<string, string>): void {
  for (const item of items) {
    const summary = item.canonicalUrl ? summaries.get(item.canonicalUrl) : undefined;
    if (summary && !item.searchText.includes(` summary: ${summary}`)) item.searchText = `${item.searchText} summary: ${summary}`.trim();
  }
}

function isEligible(item: CanonicalRecentItem): boolean {
  if (contentLength(item.searchText) >= THIN_CONTENT_CHARS || !item.canonicalUrl) return false;
  try {
    const url = new URL(item.canonicalUrl);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !isTweetStatusUrl(url);
  } catch {
    return false;
  }
}

function isTweetStatusUrl(url: URL): boolean {
  return /(^|\.)((x|twitter)\.com)$/i.test(url.hostname) && /\/status\/\d+/i.test(url.pathname);
}

function shouldAttempt(_url: string, cached: LinkEnrichmentEntry | undefined, now: Date): boolean {
  if (!cached) return true;
  if (cached.status === 'ok' && cached.summary?.trim()) return false;
  return !Number.isFinite(Date.parse(cached.enrichedAt)) || Date.parse(cached.enrichedAt) <= now.getTime() - FAILED_RETRY_MS;
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
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  try {
    initEnrichmentSchema(db);
    const rows = db.exec(`SELECT url, summary, status, enriched_at FROM link_enrichment WHERE url IN (${urls.map(() => '?').join(',')})`, urls)[0]?.values ?? [];
    saveDb(db, dbPath);
    return new Map(rows.map((row) => [String(row[0]), { url: String(row[0]), summary: row[1] == null ? null : String(row[1]), status: row[2] === 'ok' ? 'ok' : 'failed', enrichedAt: String(row[3] ?? '') }]));
  } finally {
    db.close();
  }
}

async function writeCache(entries: LinkEnrichmentEntry[]): Promise<void> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  try {
    initEnrichmentSchema(db);
    const statement = db.prepare(`INSERT INTO link_enrichment (url, summary, status, enriched_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET summary = excluded.summary, status = excluded.status, enriched_at = excluded.enriched_at`);
    try {
      for (const entry of entries) statement.run([entry.url, entry.summary, entry.status, entry.enrichedAt]);
    } finally {
      statement.free();
    }
    saveDb(db, dbPath);
  } finally {
    db.close();
  }
}

function initEnrichmentSchema(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS link_enrichment (url TEXT PRIMARY KEY, summary TEXT, status TEXT NOT NULL, enriched_at TEXT NOT NULL)');
}

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
