/**
 * HTML rendering for the daily digest.
 *
 * Same inputs as `renderDigestMarkdown`, different surface: the markdown file
 * stays the durable, greppable artifact, while this page is the readable one —
 * recall cards first, then themes as an editorial reading list with filter
 * chips and search over every row.
 */

import {
  htmlEscape,
  htmlLink,
  renderHtmlGroup,
  renderHtmlItem,
  renderHtmlPage,
  renderHtmlPanel,
  type HtmlChip,
  type HtmlItem,
} from '../html-kit.js';
import type { CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import type { DailyCollection } from './collect.js';
import type { ConnectedItem, RelatedRef } from './connect.js';
import type { DailyCoverage } from './coverage.js';
import type { ReviewCard } from './review.js';
import { extractYoutubeVideoId, type DailyTheme } from './synthesize.js';

const SNIPPET_CHARS = 220;
const CHIP_LABEL_CHARS = 26;

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  const text = oneLine(value);
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Saved text minus bare URLs — the closest thing an item has to a blurb. */
function itemBlurb(item: CanonicalRecentItem): string {
  const title = oneLine(item.displayTitle ?? '');
  const text = oneLine(item.searchText.replace(/https?:\/\/\S+/g, ' ').replace(/^summary:\s*/i, ''));
  const withoutTitle = title && text.toLowerCase().startsWith(title.toLowerCase())
    ? text.slice(title.length).trim()
    : text;
  return truncate(withoutTitle || text, SNIPPET_CHARS);
}

function savedLabel(item: CanonicalRecentItem, fallbackDate: string): string {
  const ms = item.firstSavedAt ? Date.parse(item.firstSavedAt) : NaN;
  const date = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : fallbackDate;
  return `saved ${date}`;
}

/** YouTube is the only source with a stable, cheap thumbnail URL. */
function thumbnail(url: string | null | undefined): { url: string; label?: string } | undefined {
  const videoId = extractYoutubeVideoId(url);
  return videoId ? { url: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, label: 'video' } : undefined;
}

export function renderDigestHtml(
  collection: DailyCollection,
  connected: ConnectedItem[],
  themes: DailyTheme[],
  alsoSavedIds: string[],
  usedLlm: boolean,
  youtubeNotes: Map<string, string>,
  coverage: DailyCoverage,
  dueReviews: ReviewCard[] = [],
  reviewsQueued = 0,
  llmMeta: { engine?: string; error?: string } = {},
): string {
  const itemById = new Map(collection.items.map((item) => [item.id, item]));
  const relatedById = new Map<string, RelatedRef>();
  for (const { related } of connected) {
    for (const ref of related) relatedById.set(ref.id, ref);
  }
  const notesLink = (url: string | null | undefined): string | undefined => {
    const videoId = extractYoutubeVideoId(url);
    const link = videoId ? youtubeNotes.get(videoId) : undefined;
    return link ? htmlLink(link, 'local notes') : undefined;
  };

  const themeGroupValue = (index: number): string => `theme-${index + 1}`;

  const toItem = (item: CanonicalRecentItem, group: string, lead = false): HtmlItem => {
    const notes = notesLink(item.canonicalUrl);
    return {
      title: truncate(item.displayTitle ?? item.canonicalUrl ?? item.id, 140),
      url: item.canonicalUrl ?? undefined,
      eyebrow: item.sources.join(' · '),
      byline: [savedLabel(item, collection.date), item.primaryCategory ?? undefined].filter(Boolean).join(' · '),
      body: htmlEscape(itemBlurb(item)),
      extra: notes ? [notes] : undefined,
      media: thumbnail(item.canonicalUrl),
      lead,
      group,
      searchText: item.primaryDomain ?? undefined,
    };
  };

  const sections: string[] = [];
  const chips: HtmlChip[] = [{ label: 'Everything' }];

  themes.forEach((theme, index) => {
    const group = themeGroupValue(index);
    const items = theme.itemIds
      .map((id) => itemById.get(id))
      .filter((item): item is CanonicalRecentItem => Boolean(item))
      .map((item, itemIndex) => toItem(item, group, index === 0 && itemIndex === 0));

    for (const id of theme.relatedIds) {
      const ref = relatedById.get(id);
      if (!ref) continue;
      const notes = notesLink(ref.url);
      items.push({
        title: truncate(ref.title ?? ref.url ?? id, 140),
        url: ref.url ?? undefined,
        eyebrow: 'connects to an earlier save',
        body: '',
        extra: notes ? [notes] : undefined,
        group,
      });
    }
    for (const note of theme.externalNotes) {
      items.push({
        title: truncate(note.claim, 160),
        url: note.sourceUrl ?? undefined,
        eyebrow: 'web/X context',
        byline: note.sourceLabel ? truncate(note.sourceLabel, 60) : undefined,
        openLabel: 'Source',
        group,
      });
    }

    if (items.length === 0) return;
    chips.push({ label: truncate(theme.title, CHIP_LABEL_CHARS), value: group, count: theme.itemIds.length });
    sections.push(renderHtmlGroup({
      label: truncate(theme.title, 60),
      sublabel: `Theme ${index + 1}`,
      count: `${theme.itemIds.length} item${theme.itemIds.length === 1 ? '' : 's'}`,
      intro: htmlEscape(theme.summary),
      items,
      group,
    }));
  });

  const alsoSaved = alsoSavedIds
    .map((id) => itemById.get(id))
    .filter((item): item is CanonicalRecentItem => Boolean(item))
    .map((item) => toItem(item, 'also-saved'));
  if (alsoSaved.length > 0) {
    chips.push({ label: 'Also saved', value: 'also-saved', count: alsoSaved.length });
    sections.push(renderHtmlGroup({
      label: 'Also saved',
      sublabel: 'Unthemed',
      count: `${alsoSaved.length} item${alsoSaved.length === 1 ? '' : 's'}`,
      intro: 'Collected in this window but not part of a theme — kept so nothing is dropped.',
      items: alsoSaved,
      group: 'also-saved',
    }));
  }

  if (collection.projectDeltas.length > 0) {
    const items: HtmlItem[] = collection.projectDeltas.map((delta) => ({
      title: delta.repo,
      eyebrow: 'local project',
      byline: `${delta.commits.length} commit${delta.commits.length === 1 ? '' : 's'} · ${delta.prompts.length} agent prompt${delta.prompts.length === 1 ? '' : 's'}`,
      body: htmlEscape(truncate(delta.prompts[0]?.text ?? delta.commits[0]?.subject ?? '', SNIPPET_CHARS)),
      group: 'projects',
    }));
    chips.push({ label: 'Projects', value: 'projects', count: items.length });
    sections.push(renderHtmlGroup({
      label: 'Project activity',
      sublabel: 'Your work',
      count: `${items.length} repo${items.length === 1 ? '' : 's'}`,
      items,
      group: 'projects',
    }));
  }

  // ── lede: recall cards, throughline, reflection ────────────────────────────
  const recall = dueReviews.length === 0
    ? '<p class="panel-body">No reviews are due today. New cards are introduced tomorrow so recall stays spaced.</p>'
    : dueReviews.map((card) => [
        '<div class="card">',
        `<h3>${card.url ? htmlLink(card.url, truncate(card.title, 120)) : htmlEscape(truncate(card.title, 120))}</h3>`,
        `<span class="byline">saved ${htmlEscape(card.savedAt?.slice(0, 10) ?? 'unknown')} · ${htmlEscape(card.sources.join(', ') || 'unknown source')}</span>`,
        `<p class="quote">${htmlEscape(card.prompt)}</p>`,
        '<details class="reveal"><summary>Reveal source reminder</summary>',
        `<div class="reveal-body">${htmlEscape(card.answer)}</div></details>`,
        `<p class="footnote">Grade after recalling: <code>ft review grade ${htmlEscape(card.id)} again|fuzzy|got-it</code></p>`,
        '</div>',
      ].join('')).join('');

  const throughline = usedLlm && themes.length > 0
    ? `<ul>${themes.slice(0, 3).map((theme) => `<li><b>${htmlEscape(theme.title)}</b> — ${htmlEscape(theme.summary)}</li>`).join('')}</ul>`
    : `<p>Synthesis was unavailable, so this is a structured inbox rather than a thematic briefing${llmMeta.error ? ` (${htmlEscape(truncate(llmMeta.error, 180))})` : ''}. The material below is still complete.</p>`;

  const reflection = themes[0]?.title ?? collection.items[0]?.displayTitle ?? 'today’s material';
  const project = collection.projectDeltas[0]?.repo;
  const ponder = project
    ? `What assumption in ${htmlEscape(project)} might “${htmlEscape(truncate(reflection, 80))}” change? Name the smallest experiment that would test it.`
    : `Which item in “${htmlEscape(truncate(reflection, 80))}” deserves 20 focused minutes, and what question will you try to answer before opening it?`;

  const lede = [
    renderHtmlPanel(`Recall first${dueReviews.length ? ` · ${dueReviews.length} due` : ''}`, recall),
    renderHtmlPanel('Today’s throughline', throughline),
    renderHtmlPanel('Ponder', `<p class="quote">${ponder}</p><p class="footnote">Answer this before opening more links — the point is to connect the material to your own work.</p>`),
  ].join('');

  const freshness = (['x', 'raindrop', 'github-stars', 'rss', 'youtube', 'projects'] as const)
    .map((source) => `<li>${htmlEscape(source)}: ${htmlEscape(coverage.freshness[source])}</li>`)
    .join('');
  const counts = [
    `collected ${coverage.counts.collected}`,
    `themed ${coverage.counts.themed}`,
    `also-saved ${coverage.counts.alsoSaved}`,
    `thin links skipped ${coverage.counts.thinSkipped}`,
    `carried over ${coverage.counts.carriedOver}`,
    `enriched ${coverage.counts.enriched}`,
    `citations dropped ${coverage.counts.citationsDropped}`,
    `undateable excluded ${coverage.counts.undateableExcluded}`,
    `synthesis ${coverage.counts.synthesis}`,
  ].join(' · ');
  sections.push(renderHtmlPanel('Coverage and source freshness', [
    `<ul>${freshness}</ul>`,
    '<p class="footnote">Following and X-list profiles are indexed for reference but carry no save date, so they stay out of this activity window.</p>',
    `<p class="footnote">${htmlEscape(counts)}</p>`,
  ].join(''), { collapsed: true }));

  const sourceList = [...new Set(collection.items.flatMap((item) => item.sources))].sort();
  const synthesisLabel = usedLlm ? `llm via ${llmMeta.engine ?? 'default'}` : 'mechanical';

  return renderHtmlPage({
    title: `Daily Learning Review — ${collection.date}`,
    subtitle: sourceList.length ? `Field Theory · ${sourceList.join(' · ')}` : 'Field Theory',
    stats: [
      { label: 'New saves', value: collection.items.length },
      { label: 'Themes', value: themes.length },
      { label: 'Reviews due', value: dueReviews.length },
      { label: 'Projects', value: collection.projectDeltas.length },
    ],
    metaLine: `Window <b>${htmlEscape(collection.sinceIso)}</b> → <b>${htmlEscape(collection.untilIso)}</b> · synthesis <b>${htmlEscape(synthesisLabel)}</b> · ${reviewsQueued} card${reviewsQueued === 1 ? '' : 's'} queued for tomorrow`,
    chips,
    searchPlaceholder: 'Search today’s material',
    lede,
    body: sections.join(''),
    footer: [
      `Generated by <code>ft daily</code> on ${htmlEscape(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC.`,
      `Markdown source: <code>${htmlEscape(collection.date)}.md</code> in the same folder.`,
    ].join(' '),
  });
}

/** Exported for the digest writer and tests. */
export function digestHtmlItem(item: HtmlItem): string {
  return renderHtmlItem(item);
}
