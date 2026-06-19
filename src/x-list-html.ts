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
    const image = `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`;
    const videoUrl = bestVideoUrl(media);
    if (type === 'video' || type === 'animated_gif') {
      const link = videoUrl
        ? `<a class="media-link" href="${escapeHtml(videoUrl)}" target="_blank" rel="noreferrer">Open video</a>`
        : '';
      return `<figure class="media-item video">${image}${link}</figure>`;
    }
    return `<figure class="media-item">${image}</figure>`;
  }).filter(Boolean);
  if (items.length === 0) return '';
  return `<div class="media-grid">${items.join('')}</div>`;
}

function renderLinks(links: string[] | undefined): string {
  if (!links?.length) return '';
  return `<div class="links">${links.map((link) =>
    `<a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${escapeHtml(link)}</a>`
  ).join('')}</div>`;
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
  const dataAttrs = [
    `data-likes="${metricValue(e?.likeCount)}"`,
    `data-reposts="${metricValue(e?.repostCount)}"`,
    `data-replies="${metricValue(e?.replyCount)}"`,
    `data-quotes="${metricValue(e?.quoteCount)}"`,
    `data-views="${metricValue(e?.viewCount)}"`,
    `data-time="${Number.isFinite(postedMs) ? postedMs : 0}"`,
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
      ${tweets.length ? tweets.map(renderTweet).join('') : '<p class="empty">No tweets in this section.</p>'}
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
    color-scheme: light dark;
    --bg: oklch(18% 0.012 255);
    --panel: oklch(22% 0.014 255);
    --card: oklch(25% 0.012 255);
    --card-strong: oklch(29% 0.014 255);
    --muted: oklch(72% 0.018 255);
    --text: oklch(94% 0.012 255);
    --line: oklch(35% 0.018 255);
    --line-strong: oklch(46% 0.026 255);
    --accent: oklch(74% 0.12 235);
    --accent-soft: oklch(74% 0.12 235 / .12);
    --context: oklch(75% 0.12 295);
    --context-soft: oklch(75% 0.12 295 / .13);
  }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background:
      radial-gradient(circle at top left, oklch(45% 0.08 235 / .25), transparent 32rem),
      linear-gradient(180deg, oklch(21% 0.016 255), var(--bg) 18rem);
    color: var(--text);
  }
  main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 34px 0 72px; }
  .page-header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; align-items: end; margin-bottom: 22px; }
  .eyebrow { margin: 0 0 10px; color: var(--accent); font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  h1 { margin: 0 0 10px; font-size: 38px; line-height: 1.05; letter-spacing: -.045em; }
  .meta { color: var(--muted); display: flex; flex-wrap: wrap; gap: 10px 14px; font-size: 13px; }
  .summary { display: grid; grid-template-columns: repeat(4, minmax(86px, 1fr)); gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 22px; background: oklch(19% 0.012 255 / .82); box-shadow: 0 20px 60px rgba(0,0,0,.2); }
  .summary a { min-width: 0; padding: 10px 12px; border-radius: 15px; color: var(--muted); text-decoration: none; background: var(--panel); }
  .summary b { display: block; color: var(--text); font-size: 20px; line-height: 1; margin-bottom: 5px; }
  .summary span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
  .layout { display: grid; grid-template-columns: 188px minmax(0, 1fr); gap: 24px; align-items: start; }
  .rail { position: sticky; top: 16px; display: grid; gap: 8px; padding: 10px; border: 1px solid var(--line); border-radius: 18px; background: oklch(19% 0.012 255 / .92); }
  .rail a { padding: 10px 11px; border-radius: 12px; color: var(--muted); text-decoration: none; font-size: 13px; }
  .rail a:hover { color: var(--text); background: var(--card); }
  h2 { margin: 0 0 14px; padding-top: 10px; font-size: 18px; letter-spacing: -.01em; }
  h2 span { margin-left: 8px; color: var(--accent); font-size: 13px; font-weight: 800; }
  section + section { margin-top: 26px; }
  .tweet-card { border: 1px solid var(--line); border-radius: 20px; padding: 18px 18px 16px; margin: 12px 0; background: linear-gradient(180deg, var(--card), oklch(23% 0.012 255)); box-shadow: 0 18px 48px rgba(0,0,0,.16); }
  .tweet-card.list-tweet { border-color: oklch(50% 0.06 235); background: linear-gradient(180deg, oklch(26% 0.018 245), oklch(23% 0.012 255)); }
  .tweet-card.conversation-context { border-color: oklch(48% 0.055 295); background: linear-gradient(180deg, oklch(26% 0.018 285), oklch(23% 0.012 255)); }
  .tweet-card header, .tweet-card footer { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .byline { font-weight: 760; letter-spacing: -.01em; }
  time, .quote-byline, .empty { color: var(--muted); font-size: 13px; }
  .kind { flex: 0 0 auto; padding: 5px 9px; border-radius: 999px; color: var(--accent); background: var(--accent-soft); font-size: 12px; font-weight: 800; }
  .conversation-context .kind { color: var(--context); background: var(--context-soft); }
  .tweet-text { white-space: pre-wrap; line-height: 1.55; font-size: 15px; max-width: 72ch; margin: 14px 0; }
  .media-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin: 14px 0; }
  .media-item { margin: 0; overflow: hidden; border: 1px solid var(--line); border-radius: 16px; background: oklch(16% 0.01 255); }
  .media-item img { display: block; width: 100%; max-height: 540px; object-fit: contain; }
  .media-link { display: block; padding: 10px 12px; color: var(--accent); text-decoration: none; border-top: 1px solid var(--line); }
  .quote-card { margin: 14px 0; padding: 14px; border: 1px solid var(--line); border-radius: 16px; background: oklch(20% 0.012 255); }
  .quote-label { color: var(--accent); font-size: 11px; font-weight: 850; text-transform: uppercase; letter-spacing: .09em; margin-bottom: 4px; }
  .quote-card p { white-space: pre-wrap; line-height: 1.5; margin: 10px 0; }
  .links { display: grid; gap: 6px; margin: 12px 0; overflow-wrap: anywhere; }
  .links a, .open, .quote-card a { color: var(--accent); text-underline-offset: 3px; }
  .metrics { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 12px; }
  .metrics span { display: inline-flex; align-items: baseline; gap: 5px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 999px; background: oklch(20% 0.012 255); }
  .metrics b { color: var(--text); font-size: 13px; }
  .open { flex: 0 0 auto; font-size: 13px; font-weight: 750; }
  .sortbar { position: sticky; top: 8px; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-bottom: 18px; padding: 8px; border: 1px solid var(--line); border-radius: 14px; background: oklch(20% 0.012 255 / .96); backdrop-filter: blur(8px); box-shadow: 0 12px 36px rgba(0,0,0,.22); }
  .sortbar-label { color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; margin-right: 4px; }
  .sortbar button { cursor: pointer; padding: 7px 12px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); color: var(--muted); font-size: 13px; font-weight: 650; font-family: inherit; transition: background .15s, color .15s, border-color .15s; }
  .sortbar button:hover { color: var(--text); border-color: var(--line-strong); }
  .sortbar button.active { color: var(--bg); background: var(--accent); border-color: var(--accent); }
  .sortbar #sort-dir { margin-left: auto; color: var(--accent); background: var(--accent-soft); border-color: oklch(50% 0.06 235); font-weight: 750; }
  @media (max-width: 860px) { .page-header, .layout { grid-template-columns: 1fr; } .rail { position: static; grid-template-columns: repeat(2, 1fr); } .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
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
    const dirBtn = document.getElementById('sort-dir');

    function sortAll() {
      const sections = document.querySelectorAll('section');
      sections.forEach((section) => {
        const cards = Array.from(section.querySelectorAll('.tweet-card'));
        cards
          .sort((a, b) => {
            const av = Number(a.dataset[key] || 0);
            const bv = Number(b.dataset[key] || 0);
            return dir === 'desc' ? bv - av : av - bv;
          })
          .forEach((card) => section.appendChild(card));
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

    sortAll();
  })();
</script>
</body>
</html>`;
}
