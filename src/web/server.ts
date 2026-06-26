import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import {
  countCanonicalBookmarks,
  getCanonicalBookmarkById,
  getCanonicalBookmarkSources,
  listCanonicalBookmarks,
  type CanonicalBookmarkListResult,
} from '../canonical-bookmarks-db.js';
import { getBookmarkStatusView } from '../bookmarks-service.js';
import {
  countBookmarks,
  getBookmarkById,
  getCategoryCounts,
  getDomainCounts,
  getFolderCounts,
  getStats,
  listBookmarks,
  type BookmarkTimelineFilters,
  type BookmarkTimelineItem,
} from '../bookmarks-db.js';
import { HttpError, parseBoundedInteger, requestUrl, safeRoutePath, sendError, sendJson, sendText } from './http.js';
import { loadWebMediaIndex, resolveMediaFile, type WebMediaAsset } from './media.js';
import {
  buildTodayContextPack,
  deriveTodayAnalysis,
  deriveTodaySources,
  readLatestXListDigest,
} from '../x-list-store.js';
import { fetchLinkPreview, type LinkPreview } from './link-preview.js';
import { renderAppShell, appCss, appJs } from './app-shell.js';

const linkPreviewCache = new Map<string, { at: number; value: LinkPreview }>();
const LINK_PREVIEW_TTL_MS = 60 * 60 * 1000;

async function getCachedLinkPreview(url: string): Promise<LinkPreview | null> {
  const cached = linkPreviewCache.get(url);
  if (cached && Date.now() - cached.at < LINK_PREVIEW_TTL_MS) return cached.value;
  const preview = await fetchLinkPreview(url);
  if (!preview) return null;
  linkPreviewCache.set(url, { at: Date.now(), value: preview });
  return preview;
}

export type BookmarkWebItem = BookmarkTimelineItem & { mediaAssets: WebMediaAsset[] };

export interface UnifiedWebItem {
  id: string;
  kind: 'article' | 'tweet' | 'repo' | 'video' | 'bookmark';
  title: string;
  url: string | null;
  snippet: string;
  sources: string[];
  sourceCount: number;
  savedAt: string | null;
  firstSavedAt: string | null;
  categories: string[];
  domains: string[];
  primaryCategory: string | null;
  primaryDomain: string | null;
}

function optionalParam(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)?.trim();
  return value ? value : undefined;
}

function parseBookmarkFilters(url: URL): BookmarkTimelineFilters {
  const sortValue = url.searchParams.get('sort');
  if (sortValue && sortValue !== 'asc' && sortValue !== 'desc') throw new HttpError(400, 'Invalid sort');
  return {
    query: optionalParam(url, 'query'),
    category: optionalParam(url, 'category'),
    domain: optionalParam(url, 'domain'),
    folder: optionalParam(url, 'folder'),
    author: optionalParam(url, 'author'),
    after: optionalParam(url, 'after'),
    before: optionalParam(url, 'before'),
    sort: sortValue === 'asc' ? 'asc' : 'desc',
    limit: parseBoundedInteger(url.searchParams.get('limit'), { defaultValue: 30, min: 1, max: 100 }),
    offset: parseBoundedInteger(url.searchParams.get('offset'), { defaultValue: 0, min: 0, max: 1_000_000 }),
  };
}

function parseUnifiedFilters(url: URL) {
  return {
    query: optionalParam(url, 'query'),
    source: optionalParam(url, 'source'),
    category: optionalParam(url, 'category'),
    domain: optionalParam(url, 'domain'),
    limit: parseBoundedInteger(url.searchParams.get('limit'), { defaultValue: 30, min: 1, max: 100 }),
    offset: parseBoundedInteger(url.searchParams.get('offset'), { defaultValue: 0, min: 0, max: 1_000_000 }),
  };
}

function splitTags(value: string | null): string[] {
  if (!value) return [];
  return value.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function unifiedKind(row: CanonicalBookmarkListResult): UnifiedWebItem['kind'] {
  if (row.sources.includes('github-stars')) return 'repo';
  if (row.sources.includes('youtube')) return 'video';
  if (row.sources.length === 1 && row.sources.includes('x')) return 'tweet';
  if (row.canonicalUrl) return 'article';
  return 'bookmark';
}

function snippet(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > 320 ? `${compact.slice(0, 317)}...` : compact;
}

function toUnifiedWebItem(row: CanonicalBookmarkListResult): UnifiedWebItem {
  return {
    id: row.id,
    kind: unifiedKind(row),
    title: row.displayTitle?.trim() || row.canonicalUrl || row.id,
    url: row.canonicalUrl,
    snippet: snippet(row.searchText),
    sources: row.sources,
    sourceCount: row.sourceCount,
    savedAt: row.lastSavedAt ?? row.firstSavedAt,
    firstSavedAt: row.firstSavedAt,
    categories: splitTags(row.categories),
    domains: splitTags(row.domains),
    primaryCategory: row.primaryCategory,
    primaryDomain: row.primaryDomain,
  };
}

function toCountRows(
  counts: Record<string, number>,
  labelKey: string,
  limit = 50,
): Array<{ count: number } & Record<string, string | number>> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ [labelKey]: name, count }));
}

async function enrichBookmark(item: BookmarkTimelineItem): Promise<BookmarkWebItem> {
  const mediaIndex = await loadWebMediaIndex();
  return { ...item, mediaAssets: mediaIndex.assetsByBookmarkId.get(item.id) ?? [] };
}

async function readRequiredListDigest(listId: string) {
  const digest = await readLatestXListDigest(listId);
  if (!digest) throw new HttpError(404, 'X list digest not found. Run ft x-list first.');
  return digest;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  const url = requestUrl(req);
  if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');

  if (pathname === '/api/bookmarks') {
    const filters = parseBookmarkFilters(url);
    const [items, total, mediaIndex] = await Promise.all([
      listBookmarks(filters),
      countBookmarks(filters),
      loadWebMediaIndex(),
    ]);
    sendJson(res, 200, {
      items: items.map((item): BookmarkWebItem => ({
        ...item,
        mediaAssets: mediaIndex.assetsByBookmarkId.get(item.id) ?? [],
      })),
      total,
      limit: filters.limit,
      offset: filters.offset,
    });
    return;
  }

  const bookmarkMatch = pathname.match(/^\/api\/bookmarks\/([^/]+)$/);
  if (bookmarkMatch) {
    const item = await getBookmarkById(bookmarkMatch[1]);
    if (!item) throw new HttpError(404, 'Bookmark not found');
    sendJson(res, 200, await enrichBookmark(item));
    return;
  }

  if (pathname === '/api/unified') {
    const filters = parseUnifiedFilters(url);
    const [items, total] = await Promise.all([
      listCanonicalBookmarks(filters),
      countCanonicalBookmarks(filters),
    ]);
    sendJson(res, 200, {
      items: items.map(toUnifiedWebItem),
      total,
      limit: filters.limit,
      offset: filters.offset,
    });
    return;
  }

  const unifiedMatch = pathname.match(/^\/api\/unified\/([^/]+)$/);
  if (unifiedMatch) {
    const item = await getCanonicalBookmarkById(unifiedMatch[1]);
    if (!item) throw new HttpError(404, 'Unified item not found');
    const sources = await getCanonicalBookmarkSources(item.id);
    sendJson(res, 200, { item: toUnifiedWebItem(item), sources });
    return;
  }

  if (pathname === '/api/stats') {
    const [stats, status, categoryCounts, domainCounts, folderCounts] = await Promise.all([
      getStats(),
      getBookmarkStatusView(),
      getCategoryCounts(),
      getDomainCounts(),
      getFolderCounts(),
    ]);
    sendJson(res, 200, {
      stats: { ...stats, total: stats.totalBookmarks },
      status,
      categories: toCountRows(categoryCounts, 'category'),
      domains: toCountRows(domainCounts, 'domain'),
      folders: toCountRows(folderCounts.counts, 'folder'),
    });
    return;
  }

  if (pathname === '/api/media-manifest') {
    const mediaIndex = await loadWebMediaIndex();
    sendJson(res, 200, { files: mediaIndex.filesByName.size, bookmarkCount: mediaIndex.assetsByBookmarkId.size });
    return;
  }

  if (pathname === '/api/link-preview') {
    const target = url.searchParams.get('url')?.trim();
    if (!target) throw new HttpError(400, 'Missing url');
    try {
      new URL(target);
    } catch {
      throw new HttpError(400, 'Invalid url');
    }
    const preview = await getCachedLinkPreview(target);
    if (!preview) throw new HttpError(404, 'Preview not found');
    sendJson(res, 200, preview);
    return;
  }

  const listTodayMatch = pathname.match(/^\/api\/lists\/([^/]+)\/today$/);
  if (listTodayMatch) {
    sendJson(res, 200, await readRequiredListDigest(listTodayMatch[1]));
    return;
  }

  const listAnalysisMatch = pathname.match(/^\/api\/lists\/([^/]+)\/analysis$/);
  if (listAnalysisMatch) {
    const digest = await readRequiredListDigest(listAnalysisMatch[1]);
    sendJson(res, 200, deriveTodayAnalysis(digest));
    return;
  }

  const listSourcesMatch = pathname.match(/^\/api\/lists\/([^/]+)\/sources$/);
  if (listSourcesMatch) {
    const digest = await readRequiredListDigest(listSourcesMatch[1]);
    sendJson(res, 200, { sources: deriveTodaySources(digest) });
    return;
  }

  const listContextMatch = pathname.match(/^\/api\/lists\/([^/]+)\/context$/);
  if (listContextMatch) {
    const digest = await readRequiredListDigest(listContextMatch[1]);
    sendText(res, 200, buildTodayContextPack(digest), 'text/markdown; charset=utf-8');
    return;
  }

  throw new HttpError(404, 'Not found');
}

async function handleMedia(res: ServerResponse, filename: string): Promise<void> {
  const mediaIndex = await loadWebMediaIndex();
  const mediaFile = resolveMediaFile(mediaIndex, filename);
  if (!mediaFile) throw new HttpError(404, 'Media not found');
  res.writeHead(200, {
    'content-type': mediaFile.contentType ?? 'application/octet-stream',
    'cache-control': 'private, max-age=3600',
    'x-content-type-options': 'nosniff',
  });
  createReadStream(mediaFile.path).pipe(res);
}

export function createBookmarkWebServer(): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      const pathname = safeRoutePath(req.url);
      if (pathname === '/') return sendText(res, 200, renderAppShell(), 'text/html; charset=utf-8');
      if (pathname === '/styles.css') return sendText(res, 200, appCss, 'text/css; charset=utf-8');
      if (pathname === '/app.js') return sendText(res, 200, appJs, 'text/javascript; charset=utf-8');
      if (pathname.startsWith('/api/')) return handleApi(req, res, pathname);
      if (pathname.startsWith('/media/')) return handleMedia(res, pathname.slice('/media/'.length));
      throw new HttpError(404, 'Not found');
    })().catch((error: unknown) => sendError(res, error));
  });
}

export async function runBookmarkWebServer(options: { host: string; port: number }): Promise<void> {
  const server = createBookmarkWebServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  const host = options.host;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    console.warn(`Warning: serving private bookmarks on non-localhost host ${host}`);
  }
  console.log(`Field Theory web interface: http://${host}:${port}`);
  await new Promise<void>((resolve) => {
    const close = () => server.close(() => resolve());
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  });
}
