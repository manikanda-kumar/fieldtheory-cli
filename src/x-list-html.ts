import type { BookmarkEngagementSnapshot, BookmarkMediaObject, QuotedTweetSnapshot } from './types.js';
import type { ListTimelineKind } from './x-list-timeline.js';

export interface XListHtmlTweet {
  id?: string;
  timelineKind: ListTimelineKind;
  url?: string;
  author?: string;
  authorName?: string;
  postedAt?: string | null;
  text?: string;
  links?: string[];
  engagement?: BookmarkEngagementSnapshot;
  mediaObjects?: BookmarkMediaObject[];
  quotedTweet?: QuotedTweetSnapshot;
}

export interface XListHtmlInput {
  listId: string;
  fetchedAt: string;
  tweets: XListHtmlTweet[];
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// Linkify bare URLs in already-escaped text. Runs after escapeHtml so the input
// is HTML-safe; the URL match excludes the entity-introducing `&` and quotes.
function linkifyText(value: unknown): string {
  const escaped = escapeHtml(value);
  return escaped.replace(/https?:\/\/[^\s<"']+/g, (url) => {
    // Trailing punctuation shouldn't be swallowed into the link.
    const trailing = url.match(/[.,;:!?)\]]+$/)?.[0] ?? '';
    const href = url.slice(0, url.length - trailing.length);
    return `<a href="${href}" target="_blank" rel="noreferrer">${href}</a>${trailing}`;
  });
}

function formatNumber(value: number | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat('en', { notation: value >= 10_000 ? 'compact' : 'standard' }).format(value);
}

function mediaUrl(media: BookmarkMediaObject): string | undefined {
  return media.url ?? media.mediaUrl ?? media.previewUrl;
}

function bestVideoUrl(media: BookmarkMediaObject): string | undefined {
  const variants = media.videoVariants ?? media.variants ?? [];
  const mp4s = variants
    .filter((variant) => variant.url && (!variant.contentType || variant.contentType === 'video/mp4'))
    .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
  return mp4s[0]?.url;
}

function renderMedia(mediaObjects: BookmarkMediaObject[] | undefined): string {
  if (!mediaObjects?.length) return '';
  const items = mediaObjects.map((media) => {
    const url = mediaUrl(media);
    if (!url) return '';
    const type = media.type ?? 'photo';
    const alt = media.altText ?? media.extAltText ?? (type === 'video' ? 'Video preview' : 'Tweet media');
    const videoUrl = bestVideoUrl(media);
    // Inline playback when an mp4 variant exists; the preview image is the poster.
    if ((type === 'video' || type === 'animated_gif') && videoUrl) {
      const loop = type === 'animated_gif' ? ' loop muted' : '';
      return `<figure class="media-item video"><video controls preload="none" playsinline poster="${escapeHtml(url)}"${loop} src="${escapeHtml(videoUrl)}"></video></figure>`;
    }
    const image = `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`;
    if (type === 'video' || type === 'animated_gif') {
      // No mp4 variant — fall back to the poster with a play affordance.
      return `<figure class="media-item video no-src"><span class="play-badge">▶</span>${image}</figure>`;
    }
    return `<figure class="media-item">${image}</figure>`;
  }).filter(Boolean);
  if (items.length === 0) return '';
  return `<div class="media-grid">${items.join('')}</div>`;
}

// Map a URL to a coarse source type for badging. Returns a label plus a slug
// used as a CSS modifier class.
function linkType(url: string): { label: string; slug: string } {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return { label: 'link', slug: 'other' };
  }
  const is = (...domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

  if (is('github.com', 'github.io', 'raw.githubusercontent.com', 'gist.github.com')) return { label: 'GitHub', slug: 'github' };
  if (is('youtube.com', 'youtu.be')) return { label: 'YouTube', slug: 'youtube' };
  if (is('huggingface.co')) return { label: 'Hugging Face', slug: 'huggingface' };
  if (is('arxiv.org')) return { label: 'arXiv', slug: 'arxiv' };
  if (is('x.com', 'twitter.com', 't.co')) return { label: 'X', slug: 'x' };
  if (is('substack.com')) return { label: 'Substack', slug: 'blog' };
  if (is('medium.com')) return { label: 'Medium', slug: 'blog' };
  if (is('npmjs.com')) return { label: 'npm', slug: 'npm' };
  if (is('arxiv-vanity.com', 'openreview.net', 'papers.ssrn.com')) return { label: 'Paper', slug: 'arxiv' };
  if (is('colab.research.google.com', 'kaggle.com')) return { label: 'Notebook', slug: 'notebook' };
  if (is('reddit.com')) return { label: 'Reddit', slug: 'reddit' };
  if (is('news.ycombinator.com')) return { label: 'HN', slug: 'hn' };
  if (/(^|\.)(blog|dev|hashnode|ghost\.io|wordpress\.com|bearblog\.dev)$/.test(host) || host.startsWith('blog.')) {
    return { label: 'Blog', slug: 'blog' };
  }
  return { label: host, slug: 'other' };
}

// Build the preview card's label/host/tail. Generic links show host + path;
// X-family URLs carry opaque numeric ids, so derive a human label from the
// path shape (article / broadcast / @handle post) instead of the raw id.
interface LinkPreview { label: string; slug: string; host: string; primary: string; secondary: string; }

function describeLink(url: string): LinkPreview {
  const { label, slug } = linkType(url);
  let host = '';
  let segments: string[] = [];
  let tail = '';
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./, '');
    segments = u.pathname.split('/').filter(Boolean);
    tail = `${u.pathname}${u.search}`.replace(/\/$/, '');
    if (tail === '/') tail = '';
  } catch {
    return { label, slug, host: url, primary: url, secondary: '' };
  }

  if (slug === 'x') {
    const [a, b] = segments;
    if (a === 'i' && b === 'article') return { label: 'X Article', slug, host, primary: 'X Article', secondary: 'Long-form post on X' };
    if (a === 'i' && b === 'broadcasts') return { label: 'Broadcast', slug, host, primary: 'X Broadcast', secondary: 'Live on X' };
    if (a === 'i' && b === 'status') return { label, slug, host, primary: 'X Post', secondary: 'Post on X' };
    if (segments[1] === 'status') return { label, slug, host, primary: `@${a}`, secondary: 'Post on X' };
    if (a === 'i' && b === 'spaces') return { label: 'Space', slug, host, primary: 'X Space', secondary: 'Audio on X' };
    if (segments.length === 1 && a && a !== 'i') return { label, slug, host, primary: `@${a}`, secondary: 'Profile on X' };
  }

  return { label, slug, host, primary: host, secondary: tail };
}

function renderLinks(links: string[] | undefined): string {
  if (!links?.length) return '';
  return `<div class="links">${links.map((link) => {
    const { label, slug, host, primary, secondary } = describeLink(link);
    // Favicon fetched at view time (same remote-media model as tweet images).
    const favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
    return `<a class="link-card ${slug}" href="${escapeHtml(link)}" target="_blank" rel="noreferrer">
      <img class="link-favicon" src="${escapeHtml(favicon)}" alt="" loading="lazy" width="32" height="32">
      <span class="link-body">
        <span class="link-top"><span class="link-badge ${slug}">${escapeHtml(label)}</span><span class="link-host">${escapeHtml(primary)}</span></span>
        ${secondary ? `<span class="link-tail">${escapeHtml(secondary)}</span>` : ''}
      </span>
    </a>`;
  }).join('')}</div>`;
}

function renderEngagement(engagement: BookmarkEngagementSnapshot | undefined): string {
  const parts = [
    ['Likes', engagement?.likeCount],
    ['Reposts', engagement?.repostCount],
    ['Replies', engagement?.replyCount],
    ['Quotes', engagement?.quoteCount],
    ['Views', engagement?.viewCount],
  ];
  return `<div class="metrics">${parts.map(([label, value]) =>
    `<span><b>${formatNumber(typeof value === 'number' ? value : undefined)}</b>${escapeHtml(label)}</span>`
  ).join('')}</div>`;
}

function renderQuotedTweet(quotedTweet: QuotedTweetSnapshot | undefined): string {
  if (!quotedTweet) return '';
  const byline = [quotedTweet.authorName, quotedTweet.authorHandle ? `@${quotedTweet.authorHandle}` : undefined]
    .filter(Boolean)
    .join(' · ');
  return `
    <aside class="quote-card">
      <div class="quote-label">Quoted tweet</div>
      <div class="quote-byline">${escapeHtml(byline)}</div>
      <p>${linkifyText(quotedTweet.text)}</p>
      ${renderMedia(quotedTweet.mediaObjects)}
      <a href="${escapeHtml(quotedTweet.url)}" target="_blank" rel="noreferrer">Open quoted tweet</a>
    </aside>`;
}

function metricValue(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function renderTweet(tweet: XListHtmlTweet): string {
  const byline = [tweet.authorName, tweet.author ? `@${tweet.author}` : undefined].filter(Boolean).join(' · ');
  const e = tweet.engagement;
  const postedMs = Date.parse(tweet.postedAt ?? '');
  const linkSlugs = Array.from(new Set((tweet.links ?? []).map((link) => linkType(link).slug)));
  const dataAttrs = [
    `data-likes="${metricValue(e?.likeCount)}"`,
    `data-reposts="${metricValue(e?.repostCount)}"`,
    `data-replies="${metricValue(e?.replyCount)}"`,
    `data-quotes="${metricValue(e?.quoteCount)}"`,
    `data-views="${metricValue(e?.viewCount)}"`,
    `data-time="${Number.isFinite(postedMs) ? postedMs : 0}"`,
    `data-link-types="${escapeHtml(linkSlugs.join(' '))}"`,
  ].join(' ');
  return `
    <article class="tweet-card ${escapeHtml(tweet.timelineKind)}" ${dataAttrs}>
      <header>
        <div>
          <div class="byline">${escapeHtml(byline || 'Unknown author')}</div>
          <time>${escapeHtml(tweet.postedAt ?? '')}</time>
        </div>
        <span class="kind">${tweet.timelineKind === 'list-tweet' ? 'List tweet' : tweet.timelineKind === 'conversation-context' ? 'Context' : 'Unknown'}</span>
      </header>
      <p class="tweet-text">${linkifyText(tweet.text)}</p>
      ${renderMedia(tweet.mediaObjects)}
      ${renderQuotedTweet(tweet.quotedTweet)}
      ${renderLinks(tweet.links)}
      <footer>
        ${renderEngagement(tweet.engagement)}
        ${tweet.url ? `<a class="open" href="${escapeHtml(tweet.url)}" target="_blank" rel="noreferrer">Open on X</a>` : ''}
      </footer>
    </article>`;
}

function renderSection(title: string, tweets: XListHtmlTweet[]): string {
  return `
    <section id="${title.toLowerCase().replaceAll(' ', '-')}">
      <h2>${escapeHtml(title)} <span>${tweets.length}</span></h2>
      ${tweets.length ? `<div class="tweet-grid">${tweets.map(renderTweet).join('')}</div>` : '<p class="empty">No tweets in this section.</p>'}
    </section>`;
}

export function renderXListHtml(input: XListHtmlInput): string {
  const listTweets = input.tweets.filter((tweet) => tweet.timelineKind === 'list-tweet');
  const conversationTweets = input.tweets.filter((tweet) => tweet.timelineKind === 'conversation-context');
  const unknownTweets = input.tweets.filter((tweet) => tweet.timelineKind === 'unknown');
  const mediaCount = input.tweets.filter((tweet) => (tweet.mediaObjects?.length ?? 0) > 0 || (tweet.quotedTweet?.mediaObjects?.length ?? 0) > 0).length;
  const quoteCount = input.tweets.filter((tweet) => tweet.quotedTweet).length;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>X List ${escapeHtml(input.listId)} tweets</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #000000;
    --panel: #16181c;
    --card: #16181c;
    --muted: #8b98a5;
    --text: #e7e9ea;
    --line: #2f3336;
    --line-strong: #3e4144;
    --accent: #1d9bf0;
    --accent-soft: rgb(29 155 240 / 18%);
    --context: #7856ff;
    --context-soft: rgb(120 86 255 / 13%);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    font: 15px/1.45 Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--text);
    -webkit-font-smoothing: antialiased;
  }
  main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 34px 0 72px; }
  .page-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: end; margin-bottom: 22px; }
  .eyebrow { margin: 0 0 10px; color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  h1 { margin: 0 0 10px; font-size: 38px; line-height: 1.05; letter-spacing: -.045em; }
  .meta { color: var(--muted); display: flex; flex-wrap: wrap; gap: 10px 14px; font-size: 13px; }
  .summary { display: grid; grid-template-columns: repeat(4, minmax(86px, 1fr)); gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); }
  .summary a { min-width: 0; padding: 10px 12px; border-radius: 12px; color: var(--muted); text-decoration: none; background: var(--card); }
  .summary b { display: block; color: var(--text); font-size: 20px; line-height: 1; margin-bottom: 5px; }
  .summary span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .layout { display: grid; grid-template-columns: 188px minmax(0, 1fr); gap: 24px; align-items: start; }
  .rail { position: sticky; top: 16px; display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); }
  .rail a { padding: 10px 11px; border-radius: 999px; color: var(--muted); text-decoration: none; font-size: 13px; }
  .rail a:hover { color: var(--text); background: var(--card); }
  h2 { margin: 0 0 14px; padding-top: 10px; font-size: 18px; letter-spacing: -.01em; }
  h2 span { margin-left: 8px; color: var(--accent); font-size: 13px; font-weight: 800; }
  section + section { margin-top: 26px; }
  .tweet-grid { columns: 2; column-gap: 16px; }
  .tweet-card { break-inside: avoid; display: inline-block; width: 100%; border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; margin: 0 0 16px; background: var(--card); transition: border-color .15s; }
  .tweet-card:hover { border-color: var(--line-strong); }
  .tweet-card.list-tweet .kind { border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); background: var(--accent-soft); color: var(--accent); }
  .tweet-card.conversation-context .kind { border-color: color-mix(in srgb, var(--context) 35%, var(--line)); background: var(--context-soft); color: #a78bfa; }
  .tweet-card header, .tweet-card footer { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .byline { font-weight: 760; letter-spacing: -.01em; }
  time, .quote-byline, .empty { color: var(--muted); font-size: 13px; }
  .kind { flex: 0 0 auto; padding: 3px 8px; border: 1px solid var(--line); border-radius: 999px; color: var(--accent); background: var(--accent-soft); font-size: 12px; font-weight: 600; }
  .tweet-text { white-space: pre-wrap; line-height: 1.55; font-size: 15px; max-width: 72ch; margin: 14px 0; }
  .media-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; margin: 14px 0; }
  .media-item { margin: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
  .media-item img, .media-item video { display: block; width: 100%; max-height: 460px; object-fit: contain; background: #000; }
  .media-item.video { position: relative; }
  .media-item.no-src .play-badge { position: absolute; inset: 0; display: grid; place-items: center; font-size: 34px; color: #fff; text-shadow: 0 1px 8px rgb(0 0 0 / 60%); pointer-events: none; }
  .quote-card { margin: 14px 0; padding: 14px; border: 1px solid var(--line); border-radius: 16px; background: var(--panel); }
  .quote-label { color: var(--accent); font-size: 11px; font-weight: 850; text-transform: uppercase; letter-spacing: .09em; margin-bottom: 4px; }
  .quote-card p { white-space: pre-wrap; line-height: 1.5; margin: 10px 0; }
  .links { display: grid; gap: 8px; margin: 12px 0; }
  .open, .quote-card a { color: var(--accent); text-underline-offset: 3px; }
  .link-card { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); text-decoration: none; transition: border-color .15s, background .15s; }
  .link-card:hover { border-color: var(--line-strong); background: #1d2125; }
  .link-favicon { flex: 0 0 auto; width: 32px; height: 32px; border-radius: 8px; background: var(--card); object-fit: contain; }
  .link-body { min-width: 0; display: grid; gap: 3px; }
  .link-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .link-host { color: var(--text); font-weight: 650; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .link-tail { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .link-badge { flex: 0 0 auto; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; color: var(--text); background: var(--card); border: 1px solid var(--line-strong); }
  .metrics { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 13px; }
  .metrics span { display: inline-flex; align-items: baseline; gap: 5px; }
  .metrics b { color: var(--text); font-size: 13px; }
  .open { flex: 0 0 auto; font-size: 13px; font-weight: 750; }
  .sortbar { position: sticky; top: 8px; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 18px; padding: 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
  .sortbar-label { color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; margin-right: 4px; }
  .sortbar button { cursor: pointer; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--muted); font-size: 13px; font-weight: 650; font-family: inherit; transition: background .15s, color .15s, border-color .15s; }
  .sortbar button:hover { color: var(--text); border-color: var(--line-strong); }
  .sortbar button.active { color: var(--bg); background: var(--accent); border-color: var(--accent); }
  .sortbar #sort-dir { margin-left: auto; color: var(--accent); background: var(--accent-soft); border-color: var(--line-strong); font-weight: 700; }
  .filterbar { position: sticky; top: 62px; z-index: 4; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 18px; padding: 8px; border: 1px solid var(--line); border-radius: 14px; background: var(--panel); }
  .filterbar button { cursor: pointer; padding: 6px 11px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--muted); font-size: 12px; font-weight: 650; font-family: inherit; }
  .filterbar button:hover { color: var(--text); border-color: var(--line-strong); }
  .filterbar button.active { color: #fff; background: var(--context); border-color: var(--context); }
  @media (max-width: 860px) { .page-header, .layout { grid-template-columns: 1fr; } .rail { position: static; grid-template-columns: repeat(2, 1fr); } .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 700px) { .tweet-grid { columns: 1; } }
  @media (max-width: 640px) { main { width: min(100% - 20px, 1180px); padding-top: 20px; } h1 { font-size: 30px; } .tweet-card header, .tweet-card footer { display: grid; } .rail { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<main>
  <header class="page-header">
    <div>
      <p class="eyebrow">FieldTheory digest preview</p>
      <h1>X List Tweets</h1>
      <div class="meta">
        <span>List ${escapeHtml(input.listId)}</span>
        <span>Fetched ${escapeHtml(input.fetchedAt)}</span>
        <span>${input.tweets.length} records</span>
      </div>
    </div>
    <nav class="summary" aria-label="Digest summary">
      <a href="#list-tweets"><b>${listTweets.length}</b><span>List tweets</span></a>
      <a href="#conversation-context"><b>${conversationTweets.length}</b><span>Context</span></a>
      <a href="#list-tweets"><b>${mediaCount}</b><span>With media</span></a>
      <a href="#list-tweets"><b>${quoteCount}</b><span>Quoted</span></a>
    </nav>
  </header>
  <div class="layout">
    <nav class="rail" aria-label="Sections">
      <a href="#list-tweets">List tweets</a>
      <a href="#conversation-context">Conversation context</a>
      ${unknownTweets.length ? '<a href="#unknown-timeline-records">Unknown records</a>' : ''}
    </nav>
    <div>
      <div class="sortbar" role="toolbar" aria-label="Sort tweets">
        <span class="sortbar-label">Sort by</span>
        <button type="button" data-sort="reposts" class="active">Reposts</button>
        <button type="button" data-sort="likes">Likes</button>
        <button type="button" data-sort="replies">Replies</button>
        <button type="button" data-sort="quotes">Quotes</button>
        <button type="button" data-sort="views">Views</button>
        <button type="button" data-sort="time">Recent</button>
        <button type="button" id="sort-dir" data-dir="desc" title="Toggle sort direction" aria-label="Toggle sort direction">↓ High to low</button>
      </div>
      <div class="filterbar" role="toolbar" aria-label="Filter by link type">
        <span class="sortbar-label">Links</span>
        <button type="button" data-filter="" class="active">All</button>
      </div>
      ${renderSection('List tweets', listTweets)}
      ${renderSection('Conversation context', conversationTweets)}
      ${unknownTweets.length ? renderSection('Unknown timeline records', unknownTweets) : ''}
    </div>
  </div>
</main>
<script>
  (function () {
    const bar = document.querySelector('.sortbar');
    if (!bar) return;
    let key = 'reposts';
    let dir = 'desc';
    let filter = '';
    const dirBtn = document.getElementById('sort-dir');
    const filterBar = document.querySelector('.filterbar');
    const allCards = Array.from(document.querySelectorAll('.tweet-card'));

    const LABELS = {
      github: 'GitHub', youtube: 'YouTube', huggingface: 'Hugging Face', arxiv: 'arXiv',
      blog: 'Blog', npm: 'npm', hn: 'HN', reddit: 'Reddit', notebook: 'Notebook', x: 'X', other: 'Other',
    };

    function cardTypes(card) {
      return (card.dataset.linkTypes || '').split(' ').filter(Boolean);
    }

    function applyFilter() {
      allCards.forEach((card) => {
        const match = !filter || cardTypes(card).includes(filter);
        card.style.display = match ? '' : 'none';
      });
      document.querySelectorAll('section').forEach((section) => {
        const visible = Array.from(section.querySelectorAll('.tweet-card')).filter((c) => c.style.display !== 'none').length;
        const count = section.querySelector('h2 span');
        if (count) count.textContent = visible;
      });
    }

    function sortAll() {
      document.querySelectorAll('.tweet-grid').forEach((grid) => {
        Array.from(grid.querySelectorAll('.tweet-card'))
          .sort((a, b) => {
            const av = Number(a.dataset[key] || 0);
            const bv = Number(b.dataset[key] || 0);
            return dir === 'desc' ? bv - av : av - bv;
          })
          .forEach((card) => grid.appendChild(card));
      });
    }

    bar.querySelectorAll('button[data-sort]').forEach((btn) => {
      btn.addEventListener('click', () => {
        key = btn.dataset.sort;
        bar.querySelectorAll('button[data-sort]').forEach((b) => b.classList.toggle('active', b === btn));
        sortAll();
      });
    });

    dirBtn.addEventListener('click', () => {
      dir = dir === 'desc' ? 'asc' : 'desc';
      dirBtn.dataset.dir = dir;
      dirBtn.textContent = dir === 'desc' ? '↓ High to low' : '↑ Low to high';
      sortAll();
    });

    // Build filter chips only for link types actually present, ordered by frequency.
    if (filterBar) {
      const counts = {};
      allCards.forEach((card) => cardTypes(card).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
      Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach((slug) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.dataset.filter = slug;
        btn.textContent = (LABELS[slug] || slug) + ' ' + counts[slug];
        filterBar.appendChild(btn);
      });
      filterBar.querySelectorAll('button[data-filter]').forEach((btn) => {
        btn.addEventListener('click', () => {
          filter = btn.dataset.filter;
          filterBar.querySelectorAll('button[data-filter]').forEach((b) => b.classList.toggle('active', b === btn));
          applyFilter();
        });
      });
    }

    sortAll();
    applyFilter();
  })();
</script>
</body>
</html>`;
}
