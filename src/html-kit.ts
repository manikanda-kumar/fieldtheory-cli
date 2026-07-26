/**
 * Shared HTML shell for Field Theory's generated pages (daily digest, wiki
 * index, and future rollups).
 *
 * The layout is deliberately editorial rather than dashboard-like: a warm paper
 * canvas, a serif masthead with a segmented stat strip, a sticky chip toolbar
 * with search, a left rail for the group label, and reading-list rows whose
 * text sits left of a fixed-size preview. Styles, fonts, and scripts are all
 * inlined so a page opens from disk with no network. Remote thumbnails are the
 * one exception and must degrade gracefully when offline.
 *
 * Filtering contract (implemented by the inlined script):
 *   - a row opts in with `data-filterable`, `data-group="<chip value>"`, and
 *     `data-text="<lowercased haystack>"`
 *   - a group wrapper carries `data-group-wrap` and hides when it has no
 *     visible rows
 *   - `#resultCount` receives "<visible> of <total>" on every filter change
 */

export interface HtmlStat {
  label: string;
  value: string | number;
}

export interface HtmlChip {
  label: string;
  /** Matched against a row's data-group. Omit on the "everything" chip. */
  value?: string;
  count?: number;
}

export interface HtmlMedia {
  url: string;
  label?: string;
}

export interface HtmlItem {
  title: string;
  url?: string;
  /** Small uppercase kicker above the title (category, source, theme). */
  eyebrow?: string;
  /** Muted byline after the eyebrow (handle, domain, saved date). */
  byline?: string;
  /** Main prose, already escaped or produced by htmlEscape callers. */
  body?: string;
  /** Extra links or notes rendered under the prose. */
  extra?: string[];
  footnote?: string;
  media?: HtmlMedia;
  /** Larger typography and preview for the top row of a group. */
  lead?: boolean;
  group?: string;
  /** Extra search terms beyond title/body. */
  searchText?: string;
  /** Right-aligned link label, defaults to "Open". */
  openLabel?: string;
}

export interface HtmlGroup {
  label: string;
  sublabel?: string;
  count?: string;
  /** Prose rendered above the rows (a theme summary, for instance). */
  intro?: string;
  items: HtmlItem[];
  group?: string;
}

export interface HtmlPageOptions {
  title: string;
  subtitle?: string;
  stats?: HtmlStat[];
  /** Single muted line under the masthead (dates, counts, provenance). */
  metaLine?: string;
  chips?: HtmlChip[];
  searchPlaceholder?: string;
  /** Rendered above the toolbar — recall cards, throughline, reflection. */
  lede?: string;
  body: string;
  footer?: string;
  extraCss?: string;
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function htmlEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/** Only http(s) survives: generated pages must never emit javascript: URLs. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Relative links inside the library (../youtube/foo.md) stay usable.
  if (/^[.\w][^:]*$/.test(trimmed)) return trimmed;
  return undefined;
}

export function htmlLink(url: string | null | undefined, label: string, className?: string): string {
  const href = safeHref(url);
  const text = htmlEscape(label);
  if (!href) return text;
  const attrs = className ? ` class="${htmlEscape(className)}"` : '';
  const external = /^https?:/i.test(href) ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a${attrs} href="${htmlEscape(href)}"${external}>${text}</a>`;
}

function searchHaystack(item: HtmlItem): string {
  return [item.title, item.eyebrow, item.byline, item.body, item.footnote, item.searchText, ...(item.extra ?? [])]
    .filter(Boolean)
    .join(' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .slice(0, 600);
}

export function renderHtmlItem(item: HtmlItem): string {
  const classes = ['item', ...(item.lead ? ['lead'] : [])].join(' ');
  const parts: string[] = [];
  parts.push(`<article class="${classes}" data-filterable data-group="${htmlEscape(item.group ?? '')}" data-text="${htmlEscape(searchHaystack(item))}">`);
  if (item.eyebrow || item.byline || item.url) {
    parts.push('<div class="toprow">');
    if (item.eyebrow) parts.push(`<span class="kicker">${htmlEscape(item.eyebrow)}</span>`);
    if (item.byline) parts.push(`<span class="byline">${htmlEscape(item.byline)}</span>`);
    if (safeHref(item.url)) parts.push(htmlLink(item.url, item.openLabel ?? 'Open', 'open'));
    parts.push('</div>');
  }
  parts.push(`<h3>${item.url ? htmlLink(item.url, item.title) : htmlEscape(item.title)}</h3>`);
  if (item.body) parts.push(`<div class="why">${item.body}</div>`);
  if (item.extra?.length) {
    parts.push(`<ul class="extra">${item.extra.map((entry) => `<li>${entry}</li>`).join('')}</ul>`);
  }
  if (item.footnote) parts.push(`<p class="footnote">${htmlEscape(item.footnote)}</p>`);
  if (item.media && safeHref(item.media.url)) {
    const label = item.media.label ? `<span class="media-label">${htmlEscape(item.media.label)}</span>` : '';
    parts.push(`<span class="media"><img src="${htmlEscape(safeHref(item.media.url)!)}" alt="" loading="lazy">${label}</span>`);
  }
  parts.push('</article>');
  return parts.join('');
}

export function renderHtmlGroup(group: HtmlGroup): string {
  const rows = group.items.map((item) => renderHtmlItem({ ...item, group: item.group ?? group.group })).join('');
  return [
    `<section class="daygroup" data-group-wrap data-group="${htmlEscape(group.group ?? '')}">`,
    '<div class="rail">',
    `<span class="rail-label">${htmlEscape(group.label)}</span>`,
    group.sublabel ? `<span class="rail-sub">${htmlEscape(group.sublabel)}</span>` : '',
    group.count ? `<span class="rail-count">${htmlEscape(group.count)}</span>` : '',
    '</div>',
    '<div class="rows">',
    group.intro ? `<p class="group-intro">${group.intro}</p>` : '',
    rows,
    '</div>',
    '</section>',
  ].join('');
}

export function renderHtmlPanel(title: string, body: string, options: { collapsed?: boolean } = {}): string {
  if (options.collapsed) {
    return `<details class="panel"><summary>${htmlEscape(title)}</summary><div class="panel-body">${body}</div></details>`;
  }
  return `<section class="panel"><h2>${htmlEscape(title)}</h2><div class="panel-body">${body}</div></section>`;
}

const BASE_CSS = `
:root{
  --bg:#faf8f3;--paper:#fff;--paper-2:#f4f1e9;--ink:#181712;--text:#34322b;--body:#44423a;
  --muted:#807c6f;--line:#e7e3d7;--line-strong:#cdc7b7;--accent:#b8442a;--brand:#1e5c49;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  --serif:Iowan Old Style,Palatino,Georgia,serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --bg:#14130f;--paper:#1b1a15;--paper-2:#211f19;--ink:#f4f1e8;--text:#e3dfd3;--body:#cbc6b8;
    --muted:#928c7c;--line:#2c2a23;--line-strong:#3d3a30;--accent:#e07d5e;--brand:#7fbfa5;
  }
}
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;padding:0 0 72px;background:var(--bg);color:var(--text);font:16px/1.62 var(--serif);-webkit-font-smoothing:antialiased}
body:before{content:"";display:block;height:5px;background:var(--ink)}
button,input{font:inherit;color:inherit}
img{max-width:100%}
a{color:var(--ink);text-decoration:none;border-bottom:1px solid var(--line-strong)}
a:hover{border-bottom-color:var(--accent);color:var(--accent)}
.wrap{max-width:1020px;margin:0 auto;padding:0 28px}
.masthead{padding:30px 0 20px;border-bottom:2px solid var(--ink)}
.mastrow{display:flex;align-items:flex-end;justify-content:space-between;gap:28px;flex-wrap:wrap}
.masthead h1{color:var(--ink);font:600 clamp(28px,4vw,40px)/1.05 var(--serif);letter-spacing:-.02em}
.subtitle{margin-top:8px;color:var(--muted);font:600 12px/1.5 var(--sans);letter-spacing:.02em}
.stats{display:flex;flex-wrap:wrap}
.stat{min-width:74px;padding:0 18px;border-left:1px solid var(--line-strong)}
.stat:first-child{border:0;padding-left:0}
.stat b{display:block;color:var(--ink);font:500 26px/1 var(--serif)}
.stat span{display:block;margin-top:5px;color:var(--muted);font:700 9.5px/1.3 var(--sans);letter-spacing:.13em;text-transform:uppercase}
.meta{margin-top:14px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font:600 11px/1.5 var(--sans)}
.meta b{color:var(--ink)}
.lede{padding:26px 0 4px}
.toolbar{position:sticky;top:0;z-index:10;margin:0 -28px;padding:11px 28px;background:color-mix(in srgb,var(--bg) 92%,transparent);border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}
.controls{display:flex;align-items:center;gap:6px;overflow-x:auto}
.chip{flex:0 0 auto;padding:8px 13px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--muted);font:700 11.5px/1 var(--sans);cursor:pointer;white-space:nowrap}
.chip:hover{color:var(--ink)}
.chip.active{background:var(--ink);border-color:var(--ink);color:var(--bg)}
.chip i{font-style:normal;opacity:.6;margin-left:5px}
.spacer{flex:1;min-width:12px}
.search{width:220px;height:36px;padding:0 14px;border:1px solid var(--line);border-radius:999px;background:var(--paper);font:600 12.5px/1 var(--sans);outline:none}
.search:focus{border-color:var(--line-strong)}
.results-line{display:flex;justify-content:space-between;gap:16px;margin:16px 0 0;color:var(--muted);font:600 11px/1.4 var(--sans)}
.results-line b{color:var(--ink)}
.empty{display:none;margin:40px 0;padding:44px;border:1px solid var(--line);background:var(--paper);text-align:center;color:var(--muted);font:600 13px/1.5 var(--sans)}
.empty.show{display:block}
.daygroup{display:grid;grid-template-columns:150px minmax(0,1fr);gap:30px;padding:28px 0 30px;border-bottom:1px solid var(--line-strong)}
.daygroup[hidden]{display:none}
.rail{position:sticky;top:64px;align-self:start;padding-top:6px}
.rail-label{display:block;color:var(--ink);font:600 19px/1.2 var(--serif)}
.rail-sub{display:block;margin-top:7px;color:var(--accent);font:800 10px/1.3 var(--sans);letter-spacing:.13em;text-transform:uppercase}
.rail-count{display:block;margin-top:12px;color:var(--muted);font:600 11px/1 var(--sans)}
.group-intro{margin:0 0 18px;color:var(--body);max-width:66ch}
.item{display:grid;grid-template-columns:minmax(0,1fr) 200px;grid-template-areas:"top top" "title media" "why media" "extra media";gap:0 24px;padding:20px 0;border-bottom:1px solid var(--line)}
.item[hidden]{display:none}
.item:first-of-type{padding-top:2px}
.item:last-child{border:0;padding-bottom:2px}
.item.lead{grid-template-columns:minmax(0,1fr) 260px}
.item:not(:has(.media)){grid-template-columns:minmax(0,1fr);grid-template-areas:"top" "title" "why" "extra"}
.toprow{grid-area:top;display:flex;align-items:center;gap:10px;margin-bottom:8px;flex-wrap:wrap}
.kicker{color:var(--brand);font:800 10px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase}
.byline{color:var(--muted);font:700 11.5px/1.3 var(--sans)}
.open{margin-left:auto;border:0;color:var(--muted);font:700 10.5px/1 var(--sans);letter-spacing:.08em;text-transform:uppercase}
.open:hover{border:0;color:var(--accent)}
.item h3{grid-area:title;margin:0 0 8px;color:var(--ink);font:600 20px/1.28 var(--serif);letter-spacing:-.01em}
.item h3 a{border:0}
.lead h3{font-size:25px;line-height:1.2}
.why{grid-area:why;max-width:66ch;color:var(--body)}
.extra{grid-area:extra;margin:10px 0 0;padding-left:18px;color:var(--muted);font:400 14px/1.6 var(--serif)}
.extra li{margin:3px 0}
.footnote{margin-top:8px;color:var(--muted);font:600 11px/1.4 var(--sans)}
.media{grid-area:media;position:relative;display:block;align-self:start;margin-top:3px;aspect-ratio:16/10;overflow:hidden;border:1px solid var(--line);border-radius:4px;background:var(--paper-2)}
.media img{width:100%;height:100%;object-fit:cover}
.media-label{position:absolute;left:8px;bottom:8px;padding:4px 7px;border-radius:3px;background:rgba(24,23,18,.85);color:#fff;font:700 8.5px/1 var(--sans);letter-spacing:.09em;text-transform:uppercase}
.panel{margin:26px 0;padding:22px 24px;border:1px solid var(--line);border-radius:5px;background:var(--paper)}
.panel>summary{color:var(--ink);font:700 12px/1.4 var(--sans);letter-spacing:.06em;text-transform:uppercase;cursor:pointer}
.panel h2{color:var(--ink);font:600 21px/1.2 var(--serif);margin-bottom:12px}
.panel-body{color:var(--body)}
.panel-body ul{margin:8px 0 0;padding-left:18px}
.panel-body li{margin:4px 0}
.card{padding:20px 0;border-bottom:1px solid var(--line)}
.card:last-child{border:0;padding-bottom:0}
.card h3{color:var(--ink);font:600 19px/1.3 var(--serif);margin-bottom:6px}
.card .byline{display:block;margin-bottom:10px}
.quote{margin:12px 0;padding:12px 16px;border-left:3px solid var(--accent);background:var(--paper-2);color:var(--ink);font:400 17px/1.55 var(--serif)}
.reveal{margin-top:10px}
.reveal summary{color:var(--muted);font:700 11px/1.4 var(--sans);letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
.reveal[open] summary{color:var(--ink)}
.reveal-body{margin-top:10px;color:var(--body)}
code{padding:2px 6px;border-radius:3px;background:var(--paper-2);font:600 12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
.cols{columns:2;column-gap:32px}
.cols li{break-inside:avoid}
@media(max-width:900px){
  .daygroup{grid-template-columns:1fr;gap:16px}
  .rail{position:static;display:flex;align-items:baseline;gap:12px}
  .rail-sub,.rail-count{margin:0}
  .rail-count{margin-left:auto}
  .item,.item.lead{grid-template-columns:minmax(0,1fr) 150px}
  .cols{columns:1}
}
@media(max-width:620px){
  .wrap{padding:0 18px}
  .toolbar{margin:0 -18px;padding:11px 18px}
  .item,.item.lead{grid-template-columns:1fr;grid-template-areas:"top" "media" "title" "why" "extra"}
  .media{margin:0 0 12px}
  .search{width:150px}
}
footer{margin-top:44px;padding-top:18px;border-top:2px solid var(--ink);color:var(--muted);font:600 11px/1.7 var(--sans)}
footer a{color:var(--brand);border:0}
`;

const FILTER_JS = `
(function(){
  var rows=[].slice.call(document.querySelectorAll('[data-filterable]'));
  if(!rows.length) return;
  var chips=[].slice.call(document.querySelectorAll('.chip'));
  var search=document.getElementById('search');
  var count=document.getElementById('resultCount');
  var empty=document.getElementById('empty');
  var groups=[].slice.call(document.querySelectorAll('[data-group-wrap]'));
  var active='';
  function apply(){
    var q=(search&&search.value||'').trim().toLowerCase();
    var visible=0;
    rows.forEach(function(row){
      var okGroup=!active||row.getAttribute('data-group')===active;
      var okText=!q||(row.getAttribute('data-text')||'').indexOf(q)>-1;
      var show=okGroup&&okText;
      row.hidden=!show;
      if(show) visible++;
    });
    groups.forEach(function(group){
      group.hidden=!group.querySelector('[data-filterable]:not([hidden])');
    });
    if(count) count.innerHTML='<b>'+visible+'</b> of '+rows.length;
    if(empty) empty.className=visible?'empty':'empty show';
  }
  chips.forEach(function(chip){
    chip.addEventListener('click',function(){
      active=chip.getAttribute('data-value')||'';
      chips.forEach(function(other){ other.className=other===chip?'chip active':'chip'; });
      apply();
    });
  });
  if(search) search.addEventListener('input',apply);
  apply();
})();
`;

export function renderHtmlPage(options: HtmlPageOptions): string {
  const stats = options.stats?.length
    ? `<div class="stats">${options.stats.map((stat) => `<div class="stat"><b>${htmlEscape(stat.value)}</b><span>${htmlEscape(stat.label)}</span></div>`).join('')}</div>`
    : '';
  const chips = (options.chips ?? []).length > 1
    ? (options.chips ?? []).map((chip, index) => {
        const value = chip.value ? ` data-value="${htmlEscape(chip.value)}"` : '';
        const count = chip.count === undefined ? '' : `<i>${htmlEscape(chip.count)}</i>`;
        return `<button class="chip${index === 0 ? ' active' : ''}"${value}>${htmlEscape(chip.label)}${count}</button>`;
      }).join('')
    : '';
  const search = options.searchPlaceholder
    ? `<input id="search" class="search" type="search" placeholder="${htmlEscape(options.searchPlaceholder)}" autocomplete="off">`
    : '';
  const toolbar = chips || search
    ? [
        '<div class="toolbar"><div class="controls">',
        chips,
        '<span class="spacer"></span>',
        search,
        '</div></div>',
        '<div class="results-line"><span id="resultCount"></span><span>Filters apply to the rows below</span></div>',
      ].join('')
    : '';

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${htmlEscape(options.title)}</title>`,
    `<style>${BASE_CSS}${options.extraCss ?? ''}</style>`,
    '</head>',
    '<body>',
    '<main class="wrap">',
    '<header class="masthead"><div class="mastrow"><div>',
    `<h1>${htmlEscape(options.title)}</h1>`,
    options.subtitle ? `<p class="subtitle">${htmlEscape(options.subtitle)}</p>` : '',
    '</div>',
    stats,
    '</div>',
    options.metaLine ? `<p class="meta">${options.metaLine}</p>` : '',
    '</header>',
    options.lede ? `<div class="lede">${options.lede}</div>` : '',
    toolbar,
    options.body,
    '<div class="empty" id="empty">Nothing matches that filter.</div>',
    options.footer ? `<footer>${options.footer}</footer>` : '',
    '</main>',
    `<script>${FILTER_JS}</script>`,
    '</body>',
    '</html>',
    '',
  ].filter(Boolean).join('\n');
}
