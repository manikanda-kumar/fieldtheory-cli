export function renderAppShell(): string {
  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Field Theory</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div id="app" class="site-shell">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <span class="sidebar-mark" aria-hidden="true">FT</span>
        <div class="sidebar-copy">
          <span class="sidebar-title">Field Theory</span>
          <span class="sidebar-tagline">Bookmarks and list digests</span>
        </div>
      </div>
      <nav class="sidebar-nav" aria-label="Field Theory sections">
        <button class="nav-link active" type="button" data-lane="home">Home</button>
        <button class="nav-link" type="button" data-lane="today">Today</button>
        <button class="nav-link" type="button" data-lane="analyze">Analyze</button>
        <button class="nav-link" type="button" data-lane="map">Map</button>
        <button class="nav-link" type="button" data-lane="sources">Sources</button>
        <button class="nav-link" type="button" data-lane="discuss">Discuss</button>
        <button class="nav-link" type="button" data-lane="bookmarks">Bookmarks</button>
      </nav>
      <div id="stats" class="sidebar-stats">Loading stats…</div>
      <div id="filters" class="sidebar-filters"></div>
      <div class="sidebar-footer">
        <button id="themeToggle" class="btn-secondary" type="button">Light theme</button>
      </div>
    </aside>
    <main class="main-column">
      <header class="page-header">
        <div class="page-header-row">
          <div class="page-heading">
            <h1 id="pageTitle" class="page-title">Home</h1>
            <p id="pageSubtitle" class="page-subtitle">Overview from your X list digest</p>
          </div>
        </div>
      </header>
      <div class="main-body">
        <label class="list-config">
          <span class="field-label">X List ID</span>
          <input id="listId" class="text-field" name="listId" value="1979812953135497678" inputmode="numeric">
        </label>
        <form id="searchForm" class="search-shell">
          <span class="search-icon" aria-hidden="true">⌕</span>
          <input id="query" class="search-input" name="query" type="search" autocomplete="off" placeholder="Search bookmarks, articles, links…">
          <button class="btn-primary" type="submit">Search</button>
        </form>
        <div id="activeFilters" class="active-filters"></div>
        <p id="status" class="status-line" role="status">Loading…</p>
        <section id="results" class="results" aria-live="polite"></section>
        <button id="loadMore" class="btn-primary load-more" type="button" hidden>Load more</button>
      </div>
    </main>
    <aside id="detail" class="detail-panel" hidden aria-hidden="true"></aside>
  </div>
  <script src="/app.js" type="module"></script>
</body>
</html>`;
}

export const appCss = `
:root {
  --bg: #f7f9f9;
  --bg-elevated: #ffffff;
  --bg-hover: #f7f9f9;
  --bg-active: #eff3f4;
  --bg-card: #ffffff;
  --line: #eff3f4;
  --line-strong: #cfd9de;
  --ink: #0f1419;
  --ink-soft: #536471;
  --ink-mute: #8b98a5;
  --accent: #1d9bf0;
  --accent-hover: #1a8cd8;
  --accent-press: #177cc1;
  --accent-soft: rgb(29 155 240 / 10%);
  --accent-text: #ffffff;
  --alert: #f4212e;
  --ring: rgb(29 155 240 / 35%);
  color-scheme: light;
}
[data-theme="dark"] {
  --bg: #0b0f14;
  --bg-elevated: #10151b;
  --bg-hover: #141a21;
  --bg-active: #18212a;
  --bg-card: #10151b;
  --line: #26323d;
  --line-strong: #44515d;
  --ink: #d8dee5;
  --ink-soft: #8b98a5;
  --ink-mute: #687480;
  --accent-soft: rgb(29 155 240 / 18%);
  --ring: rgb(29 155 240 / 45%);
  color-scheme: dark;
}
*, *::before, *::after { box-sizing: border-box; }
html { min-height: 100%; scrollbar-gutter: stable; }
body {
  margin: 0;
  min-height: 100%;
  background: var(--bg);
  color: var(--ink);
  font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-feature-settings: "ss01" on, "cv11" on;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
button, input, textarea { font: inherit; }
*:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.site-shell {
  display: flex;
  min-height: 100vh;
  width: 100%;
  max-width: 1440px;
  margin: 0 auto;
}
#app.detail-open .detail-panel { display: flex; }
.sidebar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 260px;
  height: 100vh;
  padding: 12px;
  border-right: 1px solid var(--line);
  background: var(--bg);
  overflow: auto;
}
.sidebar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  margin-bottom: 8px;
}
.sidebar-mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.sidebar-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.sidebar-title { font-size: 15px; font-weight: 700; letter-spacing: -0.01em; }
.sidebar-tagline { font-size: 12px; color: var(--ink-soft); }
.sidebar-nav { display: flex; flex-direction: column; gap: 2px; margin-bottom: 16px; }
.nav-link {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 10px 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ink);
  font-size: 15px;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease-out;
}
.nav-link:hover { background: var(--bg-hover); }
.nav-link.active { font-weight: 700; }
.sidebar-stats {
  display: grid;
  gap: 10px;
  margin-bottom: 14px;
  padding: 0 10px;
  color: var(--ink-soft);
  font-size: 13px;
}
.stat strong {
  display: block;
  color: var(--ink);
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.sidebar-filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 6px 12px; }
.filter-chip {
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--bg);
  color: var(--ink-soft);
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: background-color 150ms ease-out, color 150ms ease-out;
}
.filter-chip:hover { background: var(--bg-hover); color: var(--accent); }
.sidebar-footer { margin-top: auto; padding: 8px 6px 4px; }
.main-column {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  border-right: 1px solid var(--line);
  background: var(--bg);
}
.page-header {
  position: sticky;
  top: 0;
  z-index: 20;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px);
}
.page-header-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 16px 12px; }
.page-title { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.02em; }
.page-subtitle { margin: 4px 0 0; font-size: 13px; color: var(--ink-soft); }
.main-body { padding: 16px; min-width: 0; }
.field-label { display: block; margin-bottom: 6px; color: var(--ink-soft); font-size: 12px; font-weight: 600; }
.text-field {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
  color: var(--ink);
  padding: 8px 12px;
  font-size: 14px;
  transition: border-color 150ms ease-out, box-shadow 150ms ease-out;
}
.text-field:focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); outline: none; }
.list-config { display: block; margin-bottom: 14px; }
.search-shell {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  padding: 8px 12px 8px 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--bg-active);
  transition: border-color 150ms ease-out, background-color 150ms ease-out, box-shadow 150ms ease-out;
}
.search-shell:focus-within {
  border-color: var(--accent);
  background: var(--bg);
  box-shadow: 0 0 0 1px var(--accent);
}
.search-icon { flex-shrink: 0; color: var(--ink-soft); font-size: 16px; }
.search-input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--ink);
  font-size: 14px;
  outline: none;
}
.search-input::placeholder { color: var(--ink-soft); }
.btn-primary {
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-text);
  padding: 7px 16px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 150ms ease-out;
}
.btn-primary:hover { background: var(--accent-hover); }
.btn-primary:active { background: var(--accent-press); }
.btn-secondary {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--ink);
  padding: 8px 14px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 150ms ease-out;
}
.btn-secondary:hover { background: var(--bg-hover); }
.load-more { display: block; margin: 16px auto 8px; }
.active-filters { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.status-line { margin: 0 0 12px; color: var(--ink-soft); font-size: 13px; }
.results { display: grid; gap: 0; }
.results-feed {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0;
  border-top: 1px solid var(--line);
}
.results-feed > .digest-hero,
.results-feed > .source-table,
.results-feed > .bookmark-card:only-child { grid-column: 1 / -1; }
.results-analyze {
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  padding-top: 4px;
}
.results-analyze > .bookmark-card:last-child:nth-child(odd) { grid-column: 1 / -1; }
.digest-hero {
  padding: 18px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}
.digest-hero h2 { margin: 0 0 10px; font-size: 18px; font-weight: 700; }
.digest-meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--ink-soft); font-size: 13px; }
.digest-stat {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--bg-active);
  font-size: 12px;
}
.bookmark-card, .tweet-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  background: var(--bg);
  transition: background-color 150ms ease-out;
}
.bookmark-card:hover, .tweet-card:hover { background: var(--bg-hover); }
.results-feed .tweet-card:nth-child(odd) { border-right: 1px solid var(--line); }
.bookmark-card header, .tweet-card header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
}
.card-author { display: grid; gap: 1px; min-width: 0; }
.card-author strong { color: var(--ink); font-size: 15px; font-weight: 700; }
.card-author span { color: var(--ink-soft); font-size: 14px; }
.card-time { flex-shrink: 0; color: var(--ink-soft); font-size: 13px; font-variant-numeric: tabular-nums; }
.bookmark-card h2 { margin: 0 0 8px; font-size: 16px; font-weight: 700; }
.bookmark-text, .tweet-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.45;
  color: var(--ink);
  display: -webkit-box;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.meta-row, .links { display: flex; flex-wrap: wrap; gap: 6px; }
.pill {
  display: inline-flex;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--bg-active);
  color: var(--ink-soft);
  font-size: 12px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill-kind { border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); background: var(--accent-soft); color: var(--accent); }
.engagement-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  padding-top: 4px;
  color: var(--ink-soft);
  font-size: 13px;
}
.engagement-row span { font-variant-numeric: tabular-nums; }
.actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 2px; }
.details-btn {
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--ink);
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background-color 150ms ease-out;
}
.details-btn:hover { background: var(--bg-hover); }
.media-grid, .media-preview-grid {
  display: grid;
  gap: 2px;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
}
.media-preview-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
.media-grid { grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); }
.media-grid img, .media-preview img { display: block; width: 100%; object-fit: cover; }
.media-preview { position: relative; overflow: hidden; background: var(--bg-active); min-height: 100px; }
.media-preview img { max-height: 200px; min-height: 100px; }
.media-preview.video::after {
  content: "▶";
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #fff;
  font-size: 24px;
  text-shadow: 0 2px 10px rgb(0 0 0 / 55%);
  pointer-events: none;
}
.preview-grid { display: grid; gap: 8px; }
.link-preview {
  display: flex;
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--bg-card);
  color: inherit;
  text-decoration: none;
  transition: background-color 150ms ease-out;
}
.link-preview:hover { background: var(--bg-hover); text-decoration: none; }
.link-preview-thumb {
  flex-shrink: 0;
  width: 120px;
  min-height: 80px;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--bg-active);
  color: var(--ink-soft);
  font-size: 11px;
}
.link-preview-thumb img, .link-preview-thumb video { display: block; width: 100%; height: 100%; min-height: 80px; object-fit: cover; }
.link-preview-body { display: flex; flex-direction: column; gap: 3px; justify-content: center; min-width: 0; padding: 10px 12px; }
.link-preview-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--ink);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.25;
}
.link-preview-meta { overflow: hidden; color: var(--ink-soft); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.link-preview-desc {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--ink-soft);
  font-size: 13px;
  line-height: 1.35;
}
.link-preview-loading { padding: 10px 0; color: var(--ink-soft); font-size: 12px; }
.detail-panel {
  position: sticky;
  top: 0;
  display: none;
  flex-direction: column;
  flex-shrink: 0;
  width: min(380px, 34vw);
  height: 100vh;
  padding: 16px;
  border-left: 1px solid var(--line);
  background: var(--bg-elevated);
  overflow: auto;
}
.detail-panel[hidden] { display: none !important; }
.detail-panel h2 { margin: 0 0 12px; font-size: 18px; font-weight: 700; }
.detail-panel h3 { margin: 16px 0 8px; font-size: 14px; font-weight: 700; color: var(--ink-soft); }
.detail-close {
  align-self: flex-end;
  margin-bottom: 8px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: transparent;
  color: var(--ink);
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.article-text { margin: 0; white-space: pre-wrap; color: var(--ink-soft); font-size: 14px; line-height: 1.5; }
.source-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.source-table th, .source-table td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.source-table th { color: var(--ink-soft); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.bar-row { display: grid; grid-template-columns: minmax(0, 140px) 1fr 40px; gap: 10px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.bar-row:first-of-type { border-top: 0; }
.bar { height: 8px; border-radius: 999px; background: var(--accent); }
.results-analyze .bookmark-card { padding: 16px; border: 1px solid var(--line); border-radius: 16px; }
.results-analyze .bookmark-card:hover { background: var(--bg); }
.context-box {
  width: 100%;
  min-height: 360px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--bg-active);
  color: var(--ink);
  font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
  resize: vertical;
}
@media (max-width: 1100px) {
  .site-shell { flex-direction: column; max-width: none; }
  .sidebar { position: static; width: 100%; height: auto; border-right: 0; border-bottom: 1px solid var(--line); }
  .sidebar-nav { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 4px; }
  .main-column { border-right: 0; }
  .detail-panel { position: static; width: 100%; height: auto; border-left: 0; border-top: 1px solid var(--line); }
  .results-feed, .results-analyze { grid-template-columns: 1fr; }
  .results-feed .tweet-card:nth-child(odd) { border-right: 0; }
}
`;

export const appJs = `
const state = { query:'', category:'', domain:'', folder:'', offset:0, limit:30, total:0, loading:false, lane:'home' };
const laneMeta = {
  home: { title:'Home', subtitle:'Overview from your X list digest' },
  today: { title:'Today', subtitle:'Tweets from the latest list sync' },
  analyze: { title:'Analyze', subtitle:'Link types, domains, and author breakdown' },
  map: { title:'Map', subtitle:'Authors mapped to outbound domains' },
  sources: { title:'Sources', subtitle:'Shared links ranked by frequency' },
  discuss: { title:'Discuss', subtitle:'Context pack for an external LLM chat' },
  bookmarks: { title:'Bookmarks', subtitle:'Search your synced bookmark archive' },
};
const results = document.querySelector('#results');
const statusEl = document.querySelector('#status');
const loadMore = document.querySelector('#loadMore');
const detail = document.querySelector('#detail');
const app = document.querySelector('#app');
const searchForm = document.querySelector('#searchForm');
const listConfig = document.querySelector('.list-config');
const pageTitle = document.querySelector('#pageTitle');
const pageSubtitle = document.querySelector('#pageSubtitle');
const themeToggle = document.querySelector('#themeToggle');

function setDetailOpen(open) {
  app.classList.toggle('detail-open', open);
  detail.hidden = !open;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setStatus(text) { statusEl.textContent = text; }

function updatePageChrome(lane) {
  const meta = laneMeta[lane] || laneMeta.home;
  pageTitle.textContent = meta.title;
  pageSubtitle.textContent = meta.subtitle;
}

function syncThemeToggle() {
  const dark = document.documentElement.dataset.theme !== 'light';
  themeToggle.textContent = dark ? 'Light theme' : 'Dark theme';
}

function currentListId() {
  return document.querySelector('#listId')?.value.trim() || '1979812953135497678';
}

function params(resetOffset = false) {
  if (resetOffset) state.offset = 0;
  const p = new URLSearchParams({ limit:String(state.limit), offset:String(state.offset) });
  for (const key of ['query','category','domain','folder']) if (state[key]) p.set(key, state[key]);
  return p;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    let message = response.statusText;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response.json();
}

async function fetchListJson(path) {
  return fetchJson('/api/lists/' + encodeURIComponent(currentListId()) + path);
}

function renderStats(payload) {
  const stats = document.querySelector('#stats');
  stats.replaceChildren(
    Object.assign(el('div', 'stat'), { innerHTML: '<strong>' + payload.stats.total + '</strong>Total bookmarks' }),
    el('div', 'stat', (payload.status?.lastUpdated ? 'Last sync ' + payload.status.lastUpdated : 'Not synced yet')),
  );
  const filters = document.querySelector('#filters');
  filters.replaceChildren();
  for (const [kind, rows, labelKey] of [['category', payload.categories, 'category'], ['domain', payload.domains, 'domain'], ['folder', payload.folders, 'folder']]) {
    for (const row of rows.slice(0, 12)) {
      const button = el('button', 'filter-chip', row[labelKey] + ' · ' + row.count);
      button.type = 'button';
      button.addEventListener('click', () => {
        state[kind] = state[kind] === row[labelKey] ? '' : row[labelKey];
        for (const other of document.querySelectorAll('[data-lane]')) other.classList.toggle('active', other.dataset.lane === 'bookmarks');
        renderLane('bookmarks');
      });
      filters.append(button);
    }
  }
}

function authorLabel(item) {
  const handle = item.authorHandle || item.author;
  return [item.authorName, handle && '@' + handle].filter(Boolean).join(' · ') || 'Unknown author';
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
}

function linkLabel(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.length > 28 ? parsed.pathname.slice(0, 25) + '…' : parsed.pathname;
    return parsed.hostname.replace(/^www\\./, '') + (path === '/' ? '' : path);
  } catch {
    return url;
  }
}

function formatCount(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return value >= 1000 ? Intl.NumberFormat('en', { notation:'compact' }).format(value) : String(value);
}

function setResultsLayout(mode) {
  results.className = 'results' + (mode ? ' results-' + mode : '');
}

const linkPreviewCache = new Map();
let linkPreviewObserver = null;

function mediaImageUrl(media) {
  return media?.url || media?.mediaUrl || media?.previewUrl;
}

function bestVideoUrl(media) {
  const variants = media?.videoVariants || media?.variants || [];
  const mp4s = variants.filter((variant) => variant?.url && (!variant.contentType || variant.contentType === 'video/mp4'))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  return mp4s[0]?.url;
}

function collectPreviewUrls(item) {
  const urls = new Set(item.links || []);
  for (const match of (item.text || '').match(/https?:\\/\\/[^\\s<>"']+/g) || []) urls.add(match.replace(/[.,;:!?)\\]]+$/, ''));
  return Array.from(urls).slice(0, 3);
}

function renderMediaObjects(mediaObjects) {
  if (!mediaObjects?.length) return null;
  const grid = el('div', 'media-preview-grid');
  for (const media of mediaObjects) {
    const imageUrl = mediaImageUrl(media);
    if (!imageUrl) continue;
    const figure = el('figure', 'media-preview' + ((media.type === 'video' || media.type === 'animated_gif') ? ' video' : ''));
    const img = el('img');
    img.src = imageUrl;
    img.alt = media.altText || media.extAltText || 'Tweet media';
    img.loading = 'lazy';
    figure.append(img);
    const target = media.expandedUrl || bestVideoUrl(media) || imageUrl;
    const link = el('a', 'media-open', '');
    link.href = target;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.append(figure);
    grid.append(link);
  }
  return grid.childNodes.length ? grid : null;
}

function ensureLinkPreviewObserver() {
  if (linkPreviewObserver) return linkPreviewObserver;
  linkPreviewObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const slot = entry.target;
      linkPreviewObserver.unobserve(slot);
      void loadLinkPreview(slot);
    }
  }, { rootMargin: '120px' });
  return linkPreviewObserver;
}

function renderLinkPreview(preview) {
  const card = el('a', 'link-preview');
  card.href = preview.resolvedUrl || preview.url;
  card.target = '_blank';
  card.rel = 'noreferrer';
  const thumb = el('div', 'link-preview-thumb');
  if (preview.kind === 'video' && preview.resolvedUrl) {
    const video = el('video');
    video.src = preview.resolvedUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    thumb.append(video);
  } else if (preview.image) {
    const img = el('img');
    img.src = preview.image;
    img.alt = preview.title || 'Link preview';
    img.loading = 'lazy';
    thumb.append(img);
  } else {
    thumb.textContent = preview.kind === 'video' ? 'Video' : 'Link';
  }
  const body = el('div', 'link-preview-body');
  body.append(
    el('div', 'link-preview-title', preview.title || linkLabel(preview.resolvedUrl || preview.url)),
    el('div', 'link-preview-meta', preview.siteName || linkLabel(preview.resolvedUrl || preview.url)),
  );
  if (preview.description) body.append(el('div', 'link-preview-desc', preview.description));
  card.append(thumb, body);
  return card;
}

async function loadLinkPreview(slot) {
  const url = slot.dataset.previewUrl;
  if (!url) return;
  if (linkPreviewCache.has(url)) {
    slot.replaceWith(renderLinkPreview(linkPreviewCache.get(url)));
    return;
  }
  try {
    const preview = await fetchJson('/api/link-preview?url=' + encodeURIComponent(url));
    linkPreviewCache.set(url, preview);
    slot.replaceWith(renderLinkPreview(preview));
  } catch {
    slot.remove();
  }
}

function attachLinkPreviews(card, item) {
  const urls = collectPreviewUrls(item);
  if (!urls.length) return;
  const grid = el('div', 'preview-grid');
  for (const href of urls) {
    const slot = el('div', 'link-preview-loading', 'Loading preview…');
    slot.dataset.previewUrl = href;
    grid.append(slot);
    ensureLinkPreviewObserver().observe(slot);
  }
  card.append(grid);
}

function renderEngagement(item) {
  const e = item.engagement || {};
  const parts = [
    ['likes', e.likeCount],
    ['reposts', e.repostCount],
    ['replies', e.replyCount],
    ['quotes', e.quoteCount],
    ['views', e.viewCount],
  ].filter(([, count]) => formatCount(count) != null);
  if (!parts.length) return null;
  const row = el('div', 'engagement-row');
  for (const [label, count] of parts) row.append(el('span', '', formatCount(count) + ' ' + label));
  return row;
}

function renderCard(item) {
  const isTweet = Boolean(item.timelineKind);
  const card = el('article', isTweet ? 'tweet-card' : 'bookmark-card');
  const header = el('header');
  const author = el('div', 'card-author');
  const handle = item.authorHandle || item.author;
  author.append(el('strong', '', item.authorName || handle || 'Unknown author'));
  if (handle) author.append(el('span', '', '@' + handle));
  header.append(author, el('time', 'card-time', formatTime(item.bookmarkedAt || item.postedAt)));
  const text = el('p', isTweet ? 'tweet-text' : 'bookmark-text', item.text || '');
  const meta = el('div', 'meta-row');
  if (item.timelineKind) meta.append(el('span', 'pill pill-kind', item.timelineKind));
  for (const value of [...(item.categories || []), ...(item.domains || []), ...(item.folderNames || [])]) meta.append(el('span', 'pill', value));
  const links = el('div', 'links');
  for (const href of item.links || []) {
    const a = el('a', 'pill', linkLabel(href));
    a.href = href; a.target = '_blank'; a.rel = 'noreferrer'; a.title = href;
    links.append(a);
  }
  const mediaObjects = renderMediaObjects(item.mediaObjects);
  const media = el('div', 'media-grid');
  for (const asset of item.mediaAssets || []) { const img = el('img'); img.src = asset.url; img.alt = 'Downloaded bookmark media'; img.loading = 'lazy'; media.append(img); }
  const actions = el('div', 'actions');
  const open = el('a', 'details-btn', 'Open on X'); open.href = item.url; open.target = '_blank'; open.rel = 'noreferrer';
  const details = el('button', 'details-btn', 'Details'); details.type = 'button';
  details.addEventListener('click', () => isTweet ? showTweetDetail(item) : showDetail(item.id));
  actions.append(details, open);
  const engagement = renderEngagement(item);
  card.append(header, text);
  if (meta.childNodes.length) card.append(meta);
  if (links.childNodes.length) card.append(links);
  if (mediaObjects) card.append(mediaObjects);
  if (media.childNodes.length) card.append(media);
  attachLinkPreviews(card, item);
  if (engagement) card.append(engagement);
  card.append(actions);
  return card;
}

function renderBars(title, rows, key) {
  const section = el('article', 'bookmark-card');
  section.append(el('h2', '', title));
  const max = Math.max(1, ...rows.map((row) => row.count));
  for (const row of rows.slice(0, 12)) {
    const line = el('div', 'bar-row');
    line.append(el('span', '', row[key]));
    const bar = el('div', 'bar');
    bar.style.width = Math.max(4, Math.round((row.count / max) * 100)) + '%';
    line.append(bar, el('strong', '', String(row.count)));
    section.append(line);
  }
  return section;
}

async function renderHomeLane() {
  const [digest, analysis] = await Promise.all([fetchListJson('/today'), fetchListJson('/analysis')]);
  setResultsLayout('feed');
  results.replaceChildren();
  const hero = el('article', 'digest-hero');
  hero.append(el('h2', '', 'Today from list ' + digest.listId));
  const meta = el('div', 'digest-meta');
  meta.append(
    el('span', 'digest-stat', formatTime(digest.fetchedAt) || digest.fetchedAt),
    el('span', 'digest-stat', digest.tweets.length + ' tweets'),
    el('span', 'digest-stat', digest.stats.pagesFetched + ' page(s)'),
    el('span', 'digest-stat', (digest.stats.sinceHours ? digest.stats.sinceHours + 'h window' : digest.stats.stopReason)),
  );
  hero.append(meta);
  results.append(hero);
  for (const tweet of analysis.topTweets.slice(0, 6)) results.append(renderCard(tweet));
  setStatus('Home loaded from X List ' + digest.listId);
}

async function renderTodayLane() {
  const digest = await fetchListJson('/today');
  setResultsLayout('feed');
  results.replaceChildren();
  for (const tweet of digest.tweets) results.append(renderCard(tweet));
  setStatus('Showing ' + digest.tweets.length + ' list tweets');
}

async function renderAnalyzeLane() {
  const analysis = await fetchListJson('/analysis');
  setResultsLayout('analyze');
  results.replaceChildren(
    renderBars('Link types', analysis.linkTypes, 'type'),
    renderBars('Domains', analysis.domains, 'domain'),
    renderBars('Authors', analysis.authors, 'handle'),
  );
  setStatus('Analysis loaded');
}

async function renderMapLane() {
  const sources = (await fetchListJson('/sources')).sources;
  setResultsLayout('');
  results.replaceChildren();
  const card = el('article', 'bookmark-card');
  card.append(el('h2', '', 'Source map'));
  for (const source of sources.slice(0, 30)) {
    card.append(el('p', 'bookmark-text', source.authors.join(', ') + ' → ' + source.domain + ' (' + source.type + ')'));
  }
  results.append(card);
  setStatus('Map loaded');
}

async function renderSourcesLane() {
  const sources = (await fetchListJson('/sources')).sources;
  setResultsLayout('feed');
  const table = el('table', 'source-table');
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th>Type</th><th>Domain</th><th>URL</th><th>Authors</th><th>Tweets</th></tr>';
  const body = document.createElement('tbody');
  for (const source of sources) {
    const row = document.createElement('tr');
    for (const value of [source.type, source.domain, source.url, source.authors.join(', '), String(source.count)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  results.replaceChildren(table);
  setStatus('Showing ' + sources.length + ' sources');
}

async function renderDiscussLane() {
  const response = await fetch('/api/lists/' + encodeURIComponent(currentListId()) + '/context');
  if (!response.ok) throw new Error(await response.text());
  const text = await response.text();
  setResultsLayout('');
  const textarea = el('textarea', 'context-box');
  textarea.value = text;
  const copy = el('button', 'details-btn', 'Copy context');
  copy.addEventListener('click', () => navigator.clipboard.writeText(text));
  const card = el('article', 'bookmark-card');
  card.append(el('h2', '', 'Discuss context'), el('p', 'bookmark-text', 'Copy this into your preferred LLM/chat surface.'), copy, textarea);
  results.replaceChildren(card);
  setStatus('Discussion context ready');
}

async function fetchBookmarks(reset = false) {
  if (state.loading) return;
  state.loading = true;
  try {
    setStatus('Loading…');
    setResultsLayout('feed');
    const data = await fetchJson('/api/bookmarks?' + params(reset));
    if (reset) results.replaceChildren();
    for (const item of data.items) results.append(renderCard(item));
    state.total = data.total;
    state.offset = results.children.length;
    loadMore.hidden = state.offset >= state.total;
    setStatus('Showing ' + state.offset + ' of ' + state.total + ' bookmarks');
  } catch (error) {
    setStatus(error.message || 'Failed to load bookmarks');
  } finally {
    state.loading = false;
  }
}

function showTweetDetail(item) {
  setDetailOpen(true);
  detail.replaceChildren();
  const close = el('button', 'detail-close', 'Close'); close.addEventListener('click', () => setDetailOpen(false));
  detail.append(close, el('h2', '', authorLabel(item)), el('p', 'bookmark-text', item.text || ''));
  if (item.quotedTweet) detail.append(el('h3', '', 'Quoted tweet'), el('p', 'bookmark-text', item.quotedTweet.text || ''));
  const mediaObjects = renderMediaObjects(item.mediaObjects);
  if (mediaObjects) detail.append(el('h3', '', 'Media'), mediaObjects);
  const links = el('div', 'links');
  for (const href of item.links || []) { const a = el('a', 'pill', linkLabel(href)); a.href = href; a.target = '_blank'; a.rel = 'noreferrer'; a.title = href; links.append(a); }
  if (links.childNodes.length) detail.append(el('h3', '', 'Links'), links);
  attachLinkPreviews(detail, item);
}

async function showDetail(id) {
  const item = await fetchJson('/api/bookmarks/' + encodeURIComponent(id));
  setDetailOpen(true);
  detail.replaceChildren();
  const close = el('button', 'detail-close', 'Close'); close.addEventListener('click', () => setDetailOpen(false));
  detail.append(close, el('h2', '', authorLabel(item)), el('p', 'bookmark-text', item.text || ''));
  if (item.quotedTweet) detail.append(el('h3', '', 'Quoted tweet'), el('p', 'bookmark-text', item.quotedTweet.text || ''));
  if (item.articleTitle || item.articleText) detail.append(el('h3', '', item.articleTitle || 'Article text'), el('p', 'article-text', item.articleText || ''));
}

function updateLaneChrome(lane) {
  const bookmarks = lane === 'bookmarks';
  searchForm.hidden = !bookmarks;
  listConfig.hidden = bookmarks;
  loadMore.hidden = !bookmarks || state.offset >= state.total;
}

async function renderLane(lane) {
  state.lane = lane;
  updatePageChrome(lane);
  updateLaneChrome(lane);
  try {
    setStatus('Loading ' + lane + '…');
    if (lane === 'home') return renderHomeLane();
    if (lane === 'today') return renderTodayLane();
    if (lane === 'analyze') return renderAnalyzeLane();
    if (lane === 'map') return renderMapLane();
    if (lane === 'sources') return renderSourcesLane();
    if (lane === 'discuss') return renderDiscussLane();
    return fetchBookmarks(true);
  } catch (error) {
    setResultsLayout('');
    results.replaceChildren();
    setStatus(error.message || 'Failed to load ' + lane);
  }
}

let debounce;
document.querySelector('#searchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = document.querySelector('#query').value.trim();
  for (const other of document.querySelectorAll('[data-lane]')) other.classList.toggle('active', other.dataset.lane === 'bookmarks');
  renderLane('bookmarks');
});
document.querySelector('#query').addEventListener('input', (event) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    state.query = event.target.value.trim();
    for (const other of document.querySelectorAll('[data-lane]')) other.classList.toggle('active', other.dataset.lane === 'bookmarks');
    renderLane('bookmarks');
  }, 300);
});
loadMore.addEventListener('click', () => fetchBookmarks(false));

for (const button of document.querySelectorAll('[data-lane]')) {
  button.addEventListener('click', () => {
    for (const other of document.querySelectorAll('[data-lane]')) other.classList.toggle('active', other === button);
    renderLane(button.dataset.lane);
  });
}

document.querySelector('#listId').addEventListener('change', () => {
  if (state.lane !== 'bookmarks') renderLane(state.lane);
});

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('ft-theme', next); } catch {}
  syncThemeToggle();
});

try {
  const saved = localStorage.getItem('ft-theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch {}
syncThemeToggle();

fetchJson('/api/stats').then(renderStats).catch(() => {});
renderLane('home');
`;