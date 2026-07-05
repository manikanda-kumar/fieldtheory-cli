import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { youtubeLibraryDir, youtubeLibraryIndexHtmlPath } from '../paths.js';
import type { YoutubeVideoState } from './state.js';
import { loadYoutubeState, reconcileYoutubeStateFromLibrary } from './state.js';

export interface YoutubeIndexEntry {
  videoId: string;
  title: string;
  channel?: string;
  videoType?: string;
  durationSec?: number;
  published?: string | null;
  synced?: string;
  tldr?: string;
  topics?: string[];
  notesPath?: string;
  thumbnailPath?: string;
  slideCount?: number;
  audioPath?: string;
  videoPath?: string;
}

export interface RenderYoutubeIndexInput {
  generatedAt: string;
  youtubeRoot: string;
  entries: YoutubeIndexEntry[];
}

export async function writeYoutubeIndexHtml(
  entries: YoutubeIndexEntry[],
  generatedAt = new Date().toISOString(),
  playlistId?: string,
): Promise<string> {
  const outPath = youtubeLibraryIndexHtmlPath(playlistId);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, renderYoutubeIndexHtml({ generatedAt, youtubeRoot: youtubeLibraryDir(), entries }), 'utf8');
  return outPath;
}

function toIndexEntry(videoId: string, video: YoutubeVideoState): YoutubeIndexEntry {
  return {
    videoId,
    title: video.title ?? videoId,
    channel: video.channel,
    videoType: video.videoType,
    durationSec: video.durationSec,
    published: video.published,
    synced: video.updatedAt,
    tldr: video.tldr,
    topics: video.topics,
    notesPath: video.artifacts.notesPath,
    thumbnailPath: video.artifacts.thumbnailPath ?? `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`,
    slideCount: video.artifacts.slideCount ? Number(video.artifacts.slideCount) : undefined,
    audioPath: video.artifacts.audioPath,
    videoPath: video.artifacts.videoPath,
  };
}

export async function writeYoutubeIndexFromState(generatedAt = new Date().toISOString()): Promise<string> {
  await reconcileYoutubeStateFromLibrary();
  const state = await loadYoutubeState();
  const entries: YoutubeIndexEntry[] = Object.entries(state.videos)
    .filter(([, video]) => Boolean(video.artifacts.notesPath))
    .map(([videoId, video]) => toIndexEntry(videoId, video));
  return writeYoutubeIndexHtml(entries, generatedAt);
}

/**
 * Write a playlist-scoped index (`index-<playlistId>.html`) containing only the
 * videos recorded as members of that playlist in state. Shared notes/markdown
 * are untouched; a video in multiple playlists appears in each playlist index.
 * Returns null when the playlist has no members with notes yet.
 */
export async function writeYoutubePlaylistIndex(
  playlistId: string,
  generatedAt = new Date().toISOString(),
): Promise<string | null> {
  await reconcileYoutubeStateFromLibrary();
  const state = await loadYoutubeState();
  const videoIds = [...new Set(state.playlists[playlistId]?.videoIds ?? [])];
  const entries: YoutubeIndexEntry[] = videoIds
    .map((videoId) => [videoId, state.videos[videoId]] as const)
    .filter((pair): pair is readonly [string, YoutubeVideoState] => Boolean(pair[1]?.artifacts.notesPath))
    .map(([videoId, video]) => toIndexEntry(videoId, video));
  if (entries.length === 0) return null;
  return writeYoutubeIndexHtml(entries, generatedAt, playlistId);
}

export function renderYoutubeIndexHtml(input: RenderYoutubeIndexInput): string {
  const entries = [...input.entries].sort(compareEntries);
  const total = entries.length;
  const byType = countBy(entries, (entry) => entry.videoType ?? 'other');
  const byMonth = countBy(entries, monthForEntry);
  const cards = entries.map((entry) => renderCard(entry, input.youtubeRoot)).join('\n');
  const data = JSON.stringify(entries.map((entry) => ({
    ...entry,
    month: monthForEntry(entry),
    notesPath: entry.notesPath ? relativeHref(input.youtubeRoot, entry.notesPath) : undefined,
  }))).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YouTube Library</title>
<style>
:root { color-scheme: light; --bg: oklch(0.975 0.006 255); --panel: oklch(0.948 0.008 255); --ink: oklch(0.24 0.018 255); --muted: oklch(0.52 0.018 255); --line: oklch(0.88 0.01 255); --accent: oklch(0.52 0.16 255); --chip: oklch(0.92 0.026 255); }
* { box-sizing: border-box; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: var(--bg); color: var(--ink); }
.shell { min-height: 100vh; display: grid; grid-template-columns: 248px 1fr; }
.sidebar { border-right: 1px solid var(--line); background: var(--panel); padding: 22px 18px; position: sticky; top: 0; height: 100vh; overflow: auto; }
.brand { font-size: 18px; font-weight: 750; letter-spacing: -0.02em; margin-bottom: 4px; }
.meta { color: var(--muted); font-size: 12px; margin-bottom: 24px; }
.nav-section { margin: 22px 0; }
.nav-title { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px; }
.nav-item { display: flex; justify-content: space-between; gap: 12px; color: inherit; text-decoration: none; padding: 7px 8px; border-radius: 9px; font-size: 13px; }
.nav-item:hover { background: oklch(0.92 0.012 255); }
.count { color: var(--muted); font-variant-numeric: tabular-nums; }
main { padding: 28px 32px 48px; }
.toolbar { display: flex; justify-content: space-between; gap: 18px; align-items: end; margin-bottom: 24px; }
h1 { margin: 0; font-size: 28px; letter-spacing: -0.035em; }
.subtitle { margin-top: 6px; color: var(--muted); max-width: 68ch; }
.search { width: min(360px, 40vw); border: 1px solid var(--line); border-radius: 12px; padding: 11px 13px; background: oklch(0.99 0.004 255); color: var(--ink); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 18px; }
.card { background: oklch(0.992 0.004 255); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; display: flex; flex-direction: column; min-height: 100%; }
.thumb { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: var(--panel); display: block; }
.card-body { padding: 15px 15px 16px; }
.badges { display: flex; gap: 7px; flex-wrap: wrap; margin-bottom: 10px; }
.badge { font-size: 11px; color: var(--muted); background: var(--chip); border-radius: 999px; padding: 4px 8px; }
.title { color: inherit; text-decoration: none; font-size: 16px; line-height: 1.25; font-weight: 720; letter-spacing: -0.018em; }
.title:hover { color: var(--accent); }
.byline { color: var(--muted); font-size: 12px; margin-top: 7px; }
.tldr { color: oklch(0.36 0.018 255); font-size: 13px; line-height: 1.45; margin: 12px 0; }
.topics { display: flex; flex-wrap: wrap; gap: 6px; }
.topic { font-size: 11px; color: oklch(0.38 0.05 255); background: oklch(0.94 0.025 255); border-radius: 999px; padding: 4px 7px; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
.actions a { color: var(--accent); font-size: 12px; text-decoration: none; font-weight: 650; }
.empty { display: none; color: var(--muted); padding: 38px; border: 1px dashed var(--line); border-radius: 18px; text-align: center; }
@media (max-width: 780px) { .shell { grid-template-columns: 1fr; } .sidebar { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--line); } main { padding: 22px 18px 36px; } .toolbar { display: block; } .search { width: 100%; margin-top: 16px; } }
</style>
</head>
<body>
<div class="shell">
<aside class="sidebar">
  <div class="brand">YouTube Library</div>
  <div class="meta">${total} videos · Updated ${escapeHtml(formatDate(input.generatedAt))}</div>
  ${renderSidebarSection('Types', [['All', total], ...typeRows(byType)], 'type')}
  ${renderSidebarSection('Months', [...byMonth.entries()].sort().reverse(), 'month')}
</aside>
<main>
  <div class="toolbar">
    <div><h1>Saved videos</h1><div class="subtitle">Browse summaries, slides, and local overview artifacts generated by Field Theory.</div></div>
    <input class="search" id="search" type="search" placeholder="Search title, channel, topic, summary">
  </div>
  <section class="grid" id="grid">${cards}</section>
  <div class="empty" id="empty">No videos match this filter.</div>
</main>
</div>
<script type="application/json" id="youtube-index-data">${data}</script>
<script>
const search = document.getElementById('search');
const cards = [...document.querySelectorAll('.card')];
const empty = document.getElementById('empty');
const navItems = [...document.querySelectorAll('.nav-item[data-filter-kind]')];
const typeLabels = ${JSON.stringify(Object.fromEntries(['tutorial', 'talk', 'interview', 'benchmark', 'explainer', 'other'].map((t) => [labelType(t), t])))};
let activeType = null;
let activeMonth = null;

function applyFilters() {
  const q = search.value.trim().toLowerCase();
  let visible = 0;
  for (const card of cards) {
    const matchSearch = !q || card.dataset.search.includes(q);
    const matchType = !activeType || card.dataset.videoType === activeType;
    const matchMonth = !activeMonth || card.dataset.month === activeMonth;
    const show = matchSearch && matchType && matchMonth;
    card.style.display = show ? '' : 'none';
    if (show) visible += 1;
  }
  empty.style.display = visible ? 'none' : 'block';
  for (const nav of navItems) {
    const isActive = (nav.dataset.filterKind === 'type' && (nav.dataset.filterValue === 'All' ? !activeType : typeLabels[nav.dataset.filterValue] === activeType))
      || (nav.dataset.filterKind === 'month' && nav.dataset.filterValue === activeMonth);
    nav.style.background = isActive ? 'oklch(0.88 0.03 255)' : '';
    nav.style.fontWeight = isActive ? '700' : '';
  }
}

search.addEventListener('input', applyFilters);

for (const nav of navItems) {
  nav.addEventListener('click', (e) => {
    e.preventDefault();
    const kind = nav.dataset.filterKind;
    const value = nav.dataset.filterValue;
    if (kind === 'type') {
      const mapped = typeLabels[value] ?? null;
      activeType = (value === 'All' || mapped === activeType) ? null : mapped;
    } else {
      activeMonth = (value === activeMonth) ? null : value;
    }
    applyFilters();
  });
}
</script>
</body>
</html>`;
}

function renderSidebarSection(title: string, rows: Array<[string, number]>, filterKind: 'type' | 'month'): string {
  return `<div class="nav-section"><div class="nav-title">${escapeHtml(title)}</div>${rows.map(([label, count]) => `<a class="nav-item" href="#" data-filter-kind="${filterKind}" data-filter-value="${escapeAttr(label)}"><span>${escapeHtml(label)}</span><span class="count">${count}</span></a>`).join('')}</div>`;
}

function typeRows(counts: Map<string, number>): Array<[string, number]> {
  return ['tutorial', 'talk', 'interview', 'benchmark', 'explainer', 'other'].map((type) => [labelType(type), counts.get(type) ?? 0]);
}

function renderCard(entry: YoutubeIndexEntry, youtubeRoot: string): string {
  const notesHref = entry.notesPath ? relativeHref(youtubeRoot, entry.notesPath) : `https://www.youtube.com/watch?v=${encodeURIComponent(entry.videoId)}`;
  const thumbnail = entry.thumbnailPath ?? `https://i.ytimg.com/vi/${encodeURIComponent(entry.videoId)}/hqdefault.jpg`;
  const search = [entry.title, entry.channel, entry.videoType, entry.tldr, ...(entry.topics ?? [])].join(' ').toLowerCase();
  return `<article class="card" data-video-type="${escapeAttr(entry.videoType ?? 'other')}" data-month="${escapeAttr(monthForEntry(entry))}" data-search="${escapeAttr(search)}">
  <img src="${escapeAttr(thumbnail)}" alt="" class="thumb" loading="lazy">
  <div class="card-body">
    <div class="badges"><span class="badge">${escapeHtml(labelType(entry.videoType ?? 'other'))}</span><span class="badge">${escapeHtml(formatDuration(entry.durationSec))}</span>${entry.slideCount ? `<span class="badge">Slides ${entry.slideCount}</span>` : ''}</div>
    <a class="title" href="${escapeAttr(notesHref)}">${escapeHtml(entry.title)}</a>
    <div class="byline">${escapeHtml([entry.channel, formatDate(entry.published)].filter(Boolean).join(' · '))}</div>
    ${entry.tldr ? `<p class="tldr">${escapeHtml(entry.tldr)}</p>` : ''}
    <div class="topics">${(entry.topics ?? []).slice(0, 5).map((topic) => `<span class="topic">${escapeHtml(topic)}</span>`).join('')}</div>
    <div class="actions"><a href="https://www.youtube.com/watch?v=${escapeAttr(entry.videoId)}">YouTube</a>${entry.notesPath ? `<a href="${escapeAttr(notesHref)}">Summary</a>` : ''}${entry.audioPath ? `<a href="${escapeAttr(relativeHref(youtubeRoot, entry.audioPath))}">Audio</a>` : ''}${entry.videoPath ? `<a href="${escapeAttr(relativeHref(youtubeRoot, entry.videoPath))}">Video</a>` : ''}</div>
  </div>
</article>`;
}

function compareEntries(a: YoutubeIndexEntry, b: YoutubeIndexEntry): number {
  return String(b.published ?? b.synced ?? '').localeCompare(String(a.published ?? a.synced ?? '')) || a.title.localeCompare(b.title);
}

function countBy(entries: YoutubeIndexEntry[], key: (entry: YoutubeIndexEntry) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1);
  return counts;
}

function monthForEntry(entry: YoutubeIndexEntry): string {
  const value = entry.published ?? entry.synced;
  if (!value) return 'undated';
  const compact = value.match(/^(\d{4})(\d{2})\d{2}$/);
  if (compact) return `${compact[1]}-${compact[2]}`;
  const iso = value.match(/^(\d{4})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}` : 'undated';
}

function relativeHref(fromDir: string, targetPath: string): string {
  if (/^https?:\/\//i.test(targetPath)) return targetPath;
  return path.relative(fromDir, targetPath).split(path.sep).join('/');
}

function labelType(value: string): string {
  const labels: Record<string, string> = { tutorial: 'Tutorials', talk: 'Talks', interview: 'Interviews', benchmark: 'Benchmarks', explainer: 'Explainers', other: 'Other' };
  return labels[value] ?? value;
}

function formatDuration(durationSec: number | undefined): string {
  if (!durationSec) return 'unknown';
  const minutes = Math.max(1, Math.round(durationSec / 60));
  return `${minutes}m`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '';
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return value.slice(0, 10);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
