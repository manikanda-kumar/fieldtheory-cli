/** Static, semantic reading surface shared by daily output and design previews. */
import { htmlEscape, htmlLink, type HtmlGroup, type HtmlItem } from '../html-kit.js';

export const DAILY_READING_CSS = `
:root{color-scheme:light;--ink:#242721;--muted:#555b51;--line:#d9dccf;--accent:#315941;--paper:#fbfaf5}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:1.125em/1.7 Georgia,"Times New Roman",serif}
.digest{max-width:42em;margin:0 auto;padding:2.5em 1.3em 4em}
h1,h2,h3,h4{line-height:1.3;font-weight:normal;color:var(--ink)}
h1{font-size:2.4em;margin:.35em 0 .5em;letter-spacing:-.035em}
h2{font-size:1.65em;margin:0 0 .65em;break-after:avoid;page-break-after:avoid}
h3{font-size:1.2em;margin:0 0 .5em;break-after:avoid;page-break-after:avoid}
h4{font-size:1em;font-weight:bold;margin:1.6em 0 .5em}
p{margin:.6em 0 1em}
a{color:var(--accent);text-decoration:underline;text-underline-offset:.16em;overflow-wrap:anywhere}
a:hover{color:var(--ink)}
a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px}
.eyebrow,.subtitle,.byline,.section-meta,.footnote,footer{font-family:Arial,Helvetica,sans-serif;font-size:.8em;line-height:1.6;color:var(--muted)}
.eyebrow{text-transform:uppercase;letter-spacing:.16em;margin:0}
.masthead{padding-bottom:1.3em;border-bottom:2px solid var(--ink)}
.subtitle{margin:0}
.overview,.contents,.daygroup,.panel{padding:1.8em 0;border-bottom:1px solid var(--line)}
.overview p{margin-bottom:0}
.contents h2{font-size:1.1em}
.contents ol{margin:0;padding-left:1.4em}
.contents li{margin:.4em 0;padding-left:.2em}
.section-meta{margin:0 0 .8em}
.group-intro{margin-bottom:1.5em}
.item,.card{padding:1.2em 0;border-top:1px solid var(--line)}
.item:first-of-type{border-top:0;padding-top:0}
.item p:last-child{margin-bottom:0}
.byline{margin:0 0 .65em;overflow-wrap:anywhere}
.related-list{padding-left:1.2em}
.related-list li{margin:.75em 0}
.related-list .byline{display:block;margin:.2em 0 0}
.quote{margin:1em 0;padding-left:1em;border-left:2px solid var(--accent)}
.reveal-body{margin-top:.8em}
summary{cursor:pointer;color:var(--accent)}
footer{padding-top:1.5em}
code{font-size:.85em;overflow-wrap:anywhere}
@media(max-width:520px){.digest{padding:1.6em 1em 3em}h1{font-size:1.9em}h2{font-size:1.4em}}
@media print{body{background:white;color:black}.digest{max-width:none;padding:0}a{color:black;text-decoration:underline}.daygroup{break-before:page;page-break-before:always}}
`;

export interface ReadingGroup extends HtmlGroup {
  relatedItems?: HtmlItem[];
  contextItems?: HtmlItem[];
}

export function renderReadingItem(item: HtmlItem): string {
  const meta = [item.eyebrow, item.byline].filter(Boolean).join(' · ');
  return [
    '<article class="item">',
    `<h3>${item.url ? htmlLink(item.url, item.title) : htmlEscape(item.title)}</h3>`,
    meta ? `<p class="byline">${htmlEscape(meta)}</p>` : '',
    item.body ? `<p class="summary">${item.body}</p>` : '',
    item.extra?.length ? `<p class="footnote">${item.extra.join(' · ')}</p>` : '',
    item.footnote ? `<p class="footnote">${htmlEscape(item.footnote)}</p>` : '',
    '</article>',
  ].join('');
}

function references(label: string, items: HtmlItem[] = []): string {
  if (!items.length) return '';
  return `<h3>${htmlEscape(label)}</h3><ul class="related-list">${items.map((item) => `<li>${item.url ? htmlLink(item.url, item.title) : htmlEscape(item.title)}${item.byline ? `<span class="byline">${htmlEscape(item.byline)}</span>` : ''}</li>`).join('')}</ul>`;
}

export function renderReadingGroup(group: ReadingGroup): string {
  return [
    `<section class="daygroup" id="${htmlEscape(group.group ?? '')}">`,
    `<h2>${htmlEscape(group.label)}</h2>`,
    group.count ? `<p class="section-meta">${htmlEscape(group.count)}</p>` : '',
    group.intro ? `<p class="group-intro">${group.intro}</p>` : '',
    group.items.map(renderReadingItem).join(''),
    references('From earlier saves', group.relatedItems),
    references('Additional context', group.contextItems),
    '</section>',
  ].join('');
}

export function renderReadingPanel(title: string, body: string, _options?: { collapsed?: boolean }): string {
  const id = title.startsWith('Recall first') ? 'recall' : title === 'Ponder' ? 'ponder' : 'coverage';
  return `<section class="panel" id="${id}"><h2>${htmlEscape(title)}</h2><div class="panel-body">${body}</div></section>`;
}

export function renderReadingPage(options: {
  title: string; subtitle: string; overview: string;
  contents: Array<{ title: string; id: string }>; body: string; footer: string;
}): string {
  return [
    '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${htmlEscape(options.title)}</title>`, `<style>${DAILY_READING_CSS}</style>`,
    '</head>', '<body>', '<main class="digest">', '<header class="masthead">',
    '<p class="eyebrow">Field Theory · Daily reading</p>', `<h1>${htmlEscape(options.title)}</h1>`,
    `<p class="subtitle">${htmlEscape(options.subtitle)}</p>`, '</header>',
    `<section class="overview" id="overview"><h2>Today at a glance</h2><p>${htmlEscape(options.overview)}</p></section>`,
    `<nav class="contents" aria-label="Contents"><h2>Contents</h2><ol>${options.contents.map((entry) => `<li><a href="#${htmlEscape(entry.id)}">${htmlEscape(entry.title)}</a></li>`).join('')}</ol></nav>`,
    options.body, `<footer>${options.footer}</footer>`, '</main>', '</body>', '</html>', '',
  ].join('\n');
}
