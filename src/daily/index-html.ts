import fs from 'node:fs';
import path from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { htmlEscape, htmlLink, renderHtmlPage } from '../html-kit.js';

const DATE_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.md$/;
const FIXED_SECTIONS = new Set([
  'recall first',
  'today\'s throughline',
  'today’s throughline',
  'ponder',
  'today\'s material',
  'today’s material',
  'also saved',
  'project activity',
  'system details',
  'coverage and source freshness',
  'top themes',
  'notable releases & links',
  'worth a closer look',
]);

export type DailyIndexKind = 'daily' | 'x-list';

export interface DailyIndexEntry {
  date: string;
  markdownPath: string;
  htmlPath?: string;
  itemCount: number;
  themeCount: number;
  synthesis: string;
  synthesisEngine?: string;
  themes: string[];
}

export interface DailyIndexRenderOptions {
  kind?: DailyIndexKind;
  title?: string;
  description?: string;
  nav?: Array<{ label: string; href: string }>;
  now?: Date;
}

function parseScalar(value: string): string | number | string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((part) => stripQuotes(part.trim())).filter(Boolean);
  }
  const unquoted = stripQuotes(trimmed);
  if (/^-?\d+$/.test(unquoted)) return Number(unquoted);
  return unquoted;
}

function stripQuotes(value: string): string {
  return value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ? value.slice(1, -1)
    : value;
}

function parseFrontmatter(raw: string): { fields: Record<string, string | number | string[]>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { fields: {}, body: raw };
  const fields: Record<string, string | number | string[]> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (field) fields[field[1]] = parseScalar(field[2]);
  }
  return { fields, body: raw.slice(match[0].length) };
}

function stringField(fields: Record<string, string | number | string[]>, key: string): string | undefined {
  const value = fields[key];
  return typeof value === 'string' ? value : undefined;
}

function numberField(fields: Record<string, string | number | string[]>, key: string): number | undefined {
  const value = fields[key];
  return typeof value === 'number' ? value : Number.isFinite(Number(value)) ? Number(value) : undefined;
}

function extractThemes(body: string): string[] {
  const headings = [...body.matchAll(/^##\s+(.+?)\s*$/gm)]
    .map((match) => match[1].trim())
    .filter((heading) => !FIXED_SECTIONS.has(heading.toLowerCase()));
  if (headings.length > 0) return [...new Set(headings)];

  // X-list summaries put theme names as bold lines under `## Top themes`.
  const topThemes = body.match(/##\s+Top themes\s*\n([\s\S]*)/i)?.[1]?.split(/^##\s+/m)[0] ?? '';
  return [...new Set([...topThemes.matchAll(/^\*\*(.+?)\*\*\s*$/gm)].map((match) => match[1].trim()))];
}

export async function buildDailyIndexEntries(dir: string): Promise<DailyIndexEntry[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const entries: DailyIndexEntry[] = [];
  for (const name of names) {
    const match = name.match(DATE_FILE_RE);
    if (!match) continue;
    const markdownPath = path.join(dir, name);
    const raw = await readFile(markdownPath, 'utf8');
    const { fields, body } = parseFrontmatter(raw);
    const themes = extractThemes(body);
    const synthesis = stringField(fields, 'synthesis') ?? 'unknown';
    const synthesisEngine = stringField(fields, 'synthesis_engine');
    const itemCount = numberField(fields, 'new_items') ?? numberField(fields, 'tweets') ?? 0;
    const themeCount = numberField(fields, 'themes') ?? themes.length;
    const htmlPath = path.join(dir, `${match[1]}.html`);
    entries.push({
      date: match[1],
      markdownPath,
      ...(fs.existsSync(htmlPath) ? { htmlPath } : {}),
      itemCount,
      themeCount,
      synthesis,
      synthesisEngine,
      themes,
    });
  }
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

function monthLabel(date: string): string {
  const [year, month] = date.split('-').map(Number);
  return `${new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })} ${year}`;
}

function dateLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const weekday = value.toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const monthName = value.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }).toLowerCase();
  return `${weekday} ${day} ${monthName}`;
}

function defaultOptions(kind: DailyIndexKind): Required<Pick<DailyIndexRenderOptions, 'title' | 'description'>> {
  return kind === 'x-list'
    ? { title: 'X List Daily Summary', description: 'A date-indexed archive of the daily briefing from the X list.' }
    : { title: 'Daily Learning Review', description: 'A date-indexed archive of Field Theory’s daily learning reviews.' };
}

function renderEntry(entry: DailyIndexEntry, number: number, today: string, kind: DailyIndexKind): string {
  const href = entry.htmlPath ? `${entry.date}.html` : `${entry.date}.md`;
  const todayLabel = entry.date === today ? '<span class="archive-today">Today</span>' : '';
  const itemLabel = kind === 'x-list' ? `${entry.itemCount} tweet${entry.itemCount === 1 ? '' : 's'}` : `${entry.itemCount} new`;
  const synthesis = entry.synthesis === 'mechanical'
    ? '<span class="archive-badge mechanical">mechanical</span>'
    : `<span class="archive-badge">${htmlEscape(entry.synthesisEngine ?? entry.synthesis)}</span>`;
  const themes = entry.themes.length > 0
    ? `<span class="archive-themes">${entry.themes.slice(0, 3).map(htmlEscape).join(' · ')}</span>`
    : '';
  return [
    '<li class="archive-entry">',
    `<span class="archive-number">${number}.</span>`,
    '<div class="archive-entry-main">',
    `<div class="archive-date">${htmlLink(href, dateLabel(entry.date))} ${todayLabel}</div>`,
    `<div class="archive-meta"><span>${htmlEscape(itemLabel)}</span><span>${entry.themeCount} theme${entry.themeCount === 1 ? '' : 's'}</span>${synthesis}${themes}</div>`,
    '</div>',
    '</li>',
  ].join('');
}

export function renderDailyIndexHtml(entries: DailyIndexEntry[], options: DailyIndexRenderOptions = {}): string {
  const kind = options.kind ?? 'daily';
  const defaults = defaultOptions(kind);
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  const groups: Array<{ label: string; entries: DailyIndexEntry[]; start: number }> = [];
  let number = 1;
  for (const entry of [...entries].sort((a, b) => b.date.localeCompare(a.date))) {
    const label = monthLabel(entry.date);
    const group = groups.at(-1);
    if (!group || group.label !== label) groups.push({ label, entries: [], start: number });
    groups.at(-1)!.entries.push(entry);
    number += 1;
  }
  const body = [
    options.nav?.length
      ? `<nav class="archive-nav" aria-label="Library indexes">${options.nav.map((link) => htmlLink(link.href, link.label)).join(' <span>·</span> ')}</nav>`
      : '',
    '<div class="archive-intro">Pick a date to open the full artifact. Newest entries are listed first.</div>',
    groups.map((group) => [
      `<section class="archive-month"><h2>${htmlEscape(group.label)}</h2>`,
      `<ol class="archive-list" start="${group.start}">${group.entries.map((entry, index) => renderEntry(entry, group.start + index, today, kind)).join('')}</ol></section>`,
    ].join('')).join(''),
  ].join('');
  const count = entries.length;
  return renderHtmlPage({
    title: options.title ?? defaults.title,
    subtitle: options.description ?? defaults.description,
    stats: [{ label: 'Days', value: count }],
    metaLine: `Updated <b>${htmlEscape(new Date().toISOString().slice(0, 16).replace('T', ' '))}</b> UTC · ${count} archived day${count === 1 ? '' : 's'}`,
    body,
    footer: 'Generated from the markdown artifacts in this folder. Each entry prefers its readable HTML page when available.',
    extraCss: `
.archive-nav{margin:24px 0 4px;color:var(--muted);font:700 11px/1.5 var(--sans);letter-spacing:.04em}
.archive-nav a{color:var(--brand);border:0}
.archive-intro{margin:20px 0 8px;color:var(--body);font-size:18px}
.archive-month{padding:30px 0 8px;border-bottom:1px solid var(--line-strong)}
.archive-month h2{color:var(--ink);font:600 22px/1.2 var(--serif)}
.archive-list{margin:10px 0 0;padding:0;list-style:none;counter-reset:archive}
.archive-entry{display:grid;grid-template-columns:36px minmax(0,1fr);gap:10px;padding:17px 0;border-top:1px solid var(--line)}
.archive-number{color:var(--muted);font:600 14px/1.5 var(--sans);font-variant-numeric:tabular-nums}
.archive-date{color:var(--ink);font:600 22px/1.2 var(--serif)}
.archive-date a{border:0}
.archive-today{display:inline-block;margin-left:8px;padding:4px 7px;border-radius:999px;background:var(--ink);color:var(--bg);font:800 9px/1 var(--sans);letter-spacing:.1em;text-transform:uppercase;vertical-align:middle}
.archive-meta{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:7px;color:var(--muted);font:600 11px/1.4 var(--sans)}
.archive-meta>span+span{padding-left:9px;border-left:1px solid var(--line-strong)}
.archive-badge{padding:3px 7px;border:1px solid var(--line);border-radius:999px;background:var(--paper-2);color:var(--muted)}
.archive-badge.mechanical{border-color:var(--accent);color:var(--accent)}
.archive-themes{flex-basis:100%;color:var(--body);font:400 14px/1.4 var(--serif)}
@media(max-width:620px){.archive-date{font-size:20px}.archive-entry{grid-template-columns:27px minmax(0,1fr)}}`,
  });
}

export async function writeDailyIndexHtml(
  dir: string,
  options: DailyIndexRenderOptions = {},
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const indexPath = path.join(dir, 'index.html');
  const entries = await buildDailyIndexEntries(dir);
  await writeFile(indexPath, renderDailyIndexHtml(entries, options), 'utf8');
  return indexPath;
}
