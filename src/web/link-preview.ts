import { isSafeUrl, resolveTcoLink } from '../bookmark-enrich.js';

export interface LinkPreview {
  url: string;
  resolvedUrl: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  kind: 'image' | 'video' | 'link';
}

const PREVIEW_MAX_BYTES = 512 * 1024;
const PREVIEW_TIMEOUT_MS = 8_000;
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; FieldTheory/1.0; +https://fieldtheory.dev/cli)',
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function metaContent(html: string, property: string): string | undefined {
  const patterns = [
    new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]*)"`, 'i'),
    new RegExp(`<meta\\s+content="([^"]*)"\\s+property="${property}"`, 'i'),
    new RegExp(`<meta\\s+name="${property}"\\s+content="([^"]*)"`, 'i'),
    new RegExp(`<meta\\s+content="([^"]*)"\\s+name="${property}"`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return undefined;
}

export function extractLinkPreviewFromHtml(html: string): Pick<LinkPreview, 'title' | 'description' | 'image' | 'siteName'> {
  const title = metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title');
  const htmlTitle = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return {
    title: title ?? (htmlTitle ? decodeEntities(htmlTitle.replace(/<[^>]+>/g, ' ').trim()) : undefined),
    description: metaContent(html, 'og:description') ?? metaContent(html, 'description'),
    image: metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image'),
    siteName: metaContent(html, 'og:site_name'),
  };
}

function mediaKindFromUrl(url: string): 'image' | 'video' | 'link' {
  if (/\.(jpg|jpeg|png|gif|webp|avif)(\?|$)/i.test(url)) return 'image';
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) return 'video';
  return 'link';
}

function isTwitterHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return host === 'x.com' || host === 'twitter.com' || host === 't.co' || host.endsWith('.x.com');
  } catch {
    return false;
  }
}

async function fetchPreviewHtml(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREVIEW_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) return null;

    const reader = response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > PREVIEW_MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const decoder = new TextDecoder();
    return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join('') + decoder.decode();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  const original = rawUrl.trim();
  if (!original) return null;

  let resolvedUrl = original;
  if (original.includes('t.co/')) {
    const expanded = await resolveTcoLink(original);
    if (!expanded) return null;
    resolvedUrl = expanded;
  }

  if (!isSafeUrl(resolvedUrl) || isTwitterHost(resolvedUrl)) return null;

  const kind = mediaKindFromUrl(resolvedUrl);
  if (kind === 'image') {
    return { url: original, resolvedUrl, image: resolvedUrl, kind };
  }
  if (kind === 'video') {
    return { url: original, resolvedUrl, kind: 'video' };
  }

  const html = await fetchPreviewHtml(resolvedUrl);
  if (!html) {
    return { url: original, resolvedUrl, kind: 'link' };
  }

  const meta = extractLinkPreviewFromHtml(html);
  return {
    url: original,
    resolvedUrl,
    kind: 'link',
    ...meta,
  };
}