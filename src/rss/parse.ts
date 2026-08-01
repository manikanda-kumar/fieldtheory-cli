import crypto from 'node:crypto';
import type { RssItemRecord } from './types.js';

export interface ParsedFeedItem {
  title: string;
  link: string;
  guid: string | null;
  summary: string | null;
  author: string | null;
  publishedAt: string | null;
}

export interface ParsedFeed {
  title: string | null;
  items: ParsedFeedItem[];
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
}

function stripTags(value: string): string {
  return decodeXmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagContent(block: string, tag: string): string | null {
  // Prefer CDATA or nested content; non-greedy across common feed tags.
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return null;
  return m[1];
}

function tagAttr(block: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["'][^>]*/?>`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}

function firstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (value == null) continue;
    const cleaned = stripTags(value);
    if (cleaned) return cleaned;
  }
  return null;
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = stripTags(raw);
  if (!cleaned) return null;
  const ms = Date.parse(cleaned);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function parseRss20(xml: string): ParsedFeed {
  const channel = xml.match(/<channel\b[\s\S]*?<\/channel>/i)?.[0] ?? xml;
  const title = firstText(tagContent(channel, 'title'));
  const items: ParsedFeedItem[] = [];
  const itemBlocks = channel.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  for (const block of itemBlocks) {
    const link = firstText(
      tagContent(block, 'link'),
      tagAttr(block, 'link', 'href'),
      tagContent(block, 'guid'),
    );
    if (!link || !/^https?:\/\//i.test(link)) continue;
    items.push({
      title: firstText(tagContent(block, 'title')) ?? link,
      link,
      guid: firstText(tagContent(block, 'guid')),
      summary: firstText(
        tagContent(block, 'description'),
        tagContent(block, 'content:encoded'),
        tagContent(block, 'summary'),
      ),
      author: firstText(
        tagContent(block, 'author'),
        tagContent(block, 'dc:creator'),
        tagContent(block, 'creator'),
      ),
      publishedAt: normalizeDate(
        firstText(tagContent(block, 'pubDate'), tagContent(block, 'dc:date'), tagContent(block, 'date')),
      ),
    });
  }
  return { title, items };
}

function parseAtom(xml: string): ParsedFeed {
  const feedBlock = xml.match(/<feed\b[\s\S]*?<\/feed>/i)?.[0] ?? xml;
  const title = firstText(tagContent(feedBlock, 'title'));
  const items: ParsedFeedItem[] = [];
  const entryBlocks = feedBlock.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  for (const block of entryBlocks) {
    // Prefer rel=alternate, else first link href, else id if URL-like.
    const alternate = block.match(/<link\b[^>]*\brel\s*=\s*["']alternate["'][^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\/?>/i)
      ?? block.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\brel\s*=\s*["']alternate["'][^>]*\/?>/i);
    const anyLink = tagAttr(block, 'link', 'href');
    const id = firstText(tagContent(block, 'id'));
    const link = firstText(alternate?.[1], anyLink, id && /^https?:\/\//i.test(id) ? id : null);
    if (!link || !/^https?:\/\//i.test(link)) continue;
    items.push({
      title: firstText(tagContent(block, 'title')) ?? link,
      link,
      guid: id,
      summary: firstText(tagContent(block, 'summary'), tagContent(block, 'content')),
      author: firstText(
        (() => {
          const authorBlock = block.match(/<author\b[\s\S]*?<\/author>/i)?.[0];
          return authorBlock ? tagContent(authorBlock, 'name') : null;
        })(),
      ),
      publishedAt: normalizeDate(
        firstText(tagContent(block, 'published'), tagContent(block, 'updated')),
      ),
    });
  }
  return { title, items };
}

/** Parse RSS 2.0 or Atom XML into a feed of link-bearing items. */
export function parseFeedXml(xml: string): ParsedFeed {
  const head = xml.slice(0, 2000).toLowerCase();
  if (head.includes('<feed') && (head.includes('atom') || head.includes('<entry'))) {
    return parseAtom(xml);
  }
  if (head.includes('<rss') || head.includes('<rdf:rdf') || head.includes('<channel')) {
    return parseRss20(xml);
  }
  // Fallbacks: try atom then rss.
  const atom = parseAtom(xml);
  if (atom.items.length) return atom;
  return parseRss20(xml);
}

export function itemIdFor(feedUrl: string, guid: string | null, link: string): string {
  const key = `${feedUrl}|${guid || link}`;
  return crypto.createHash('sha1').update(key).digest('hex');
}

export function toRssItemRecord(
  item: ParsedFeedItem,
  feedUrl: string,
  feedName: string,
  syncedAt: string,
): RssItemRecord {
  return {
    id: itemIdFor(feedUrl, item.guid, item.link),
    feedUrl,
    feedName,
    title: item.title,
    link: item.link,
    guid: item.guid,
    summary: item.summary ? item.summary.slice(0, 4000) : null,
    author: item.author,
    publishedAt: item.publishedAt,
    syncedAt,
  };
}
