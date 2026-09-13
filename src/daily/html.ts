/**
 * HTML rendering for the daily digest.
 *
 * Same inputs as `renderDigestMarkdown`, different surface: the markdown file
 * stays the durable artifact. This static reading surface uses full headings,
 * paragraph summaries and descriptive links for HTML-to-EPUB conversion.
 */

import { htmlEscape, htmlLink, type HtmlItem } from '../html-kit.js';
import {
  renderReadingGroup as renderHtmlGroup,
  renderReadingItem as renderHtmlItem,
  renderReadingPage,
  renderReadingPanel as renderHtmlPanel,
} from './reading-html.js';
import { summarizeSavedText, truncateAtBoundary } from './summary.js';
import type { CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import type { DailyCollection } from './collect.js';
import type { ConnectedItem, RelatedRef } from './connect.js';
import type { DailyCoverage } from './coverage.js';
import type { ReviewCard } from './review.js';
import { dailyItemDisplaySummary, displayDomain, extractYoutubeVideoId, type DailyTheme } from './synthesize.js';

const SNIPPET_CHARS = 220;


function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  const text = oneLine(value);
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function savedLabel(item: CanonicalRecentItem, fallbackDate: string): string {
  const ms = item.firstSavedAt ? Date.parse(item.firstSavedAt) : NaN;
  const date = Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : fallbackDate;
  return `saved ${date}`;
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
      title: oneLine(item.displayTitle ?? item.canonicalUrl ?? item.id),
      url: item.canonicalUrl ?? undefined,
      eyebrow: displayDomain(item.canonicalUrl) || item.sources.join(' · '),
      byline: [savedLabel(item, collection.date), item.primaryCategory ?? undefined].filter(Boolean).join(' · '),
      body: htmlEscape(dailyItemDisplaySummary(item) ? summarizeSavedText(item, 700) : ''),
      extra: notes ? [notes] : undefined,
      lead,
      group,
      searchText: item.primaryDomain ?? undefined,
    };
  };

  const sections: string[] = [];
  const contents: Array<{ title: string; id: string }> = [];

  themes.forEach((theme, index) => {
    const group = themeGroupValue(index);
    const items = theme.itemIds
      .map((id) => itemById.get(id))
      .filter((item): item is CanonicalRecentItem => Boolean(item))
      .map((item, itemIndex) => toItem(item, group, index === 0 && itemIndex === 0));

    const relatedItems: HtmlItem[] = [];
    const contextItems: HtmlItem[] = [];
    for (const id of theme.relatedIds) {
      const ref = relatedById.get(id);
      if (!ref) continue;
      const notes = notesLink(ref.url);
      const refDomain = displayDomain(ref.url);
      relatedItems.push({
        title: oneLine(ref.title ?? ref.url ?? id),
        url: ref.url ?? undefined,
        eyebrow: 'connects to an earlier save',
        byline: refDomain || undefined,
        body: '',
        extra: notes ? [notes] : undefined,
        group,
        searchText: refDomain || undefined,
      });
    }
    for (const note of theme.externalNotes) {
      contextItems.push({
        title: oneLine(note.claim),
        url: note.sourceUrl ?? undefined,
        eyebrow: 'web/X context',
        byline: note.sourceLabel ? truncate(note.sourceLabel, 60) : undefined,
        openLabel: 'Source',
        group,
      });
    }

    if (items.length + relatedItems.length + contextItems.length === 0) return;
    contents.push({ title: theme.title, id: group });
    sections.push(renderHtmlGroup({
      label: theme.title,
      sublabel: `Theme ${index + 1}`,
      count: `${theme.itemIds.length} item${theme.itemIds.length === 1 ? '' : 's'}`,
      intro: htmlEscape(oneLine(theme.summary)),
      items,
      relatedItems,
      contextItems,
      group,
    }));
  });

  const alsoSaved = alsoSavedIds
    .map((id) => itemById.get(id))
    .filter((item): item is CanonicalRecentItem => Boolean(item))
    .map((item) => toItem(item, 'also-saved'));
  if (alsoSaved.length > 0) {
    contents.push({ title: 'Also saved', id: 'also-saved' });
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
    contents.push({ title: 'Project activity', id: 'projects' });
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
        `<h3>${card.url ? htmlLink(card.url, oneLine(card.title)) : htmlEscape(oneLine(card.title))}</h3>`,
        `<span class="byline">saved ${htmlEscape(card.savedAt?.slice(0, 10) ?? 'unknown')} · ${htmlEscape(card.sources.join(', ') || 'unknown source')}</span>`,
        `<p class="quote">${htmlEscape(card.prompt)}</p>`,
        '<h4>Source reminder</h4>',
        `<p class="reveal-body">${htmlEscape(card.answer)}</p>`,
        '</div>',
      ].join('')).join('');

  const overview = usedLlm && themes.length > 0
    ? themes.slice(0, 3).map((theme) => {
        const summary = oneLine(theme.summary);
        const sentence = summary.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? summary;
        return truncateAtBoundary(sentence, 300);
      }).filter(Boolean).join(' ')
    : 'Synthesis was unavailable, so today’s saves are organized by source. The reading list below includes all collected material.';

  const reflection = themes[0]?.title ?? collection.items[0]?.displayTitle ?? 'today’s material';
  const project = collection.projectDeltas[0]?.repo;
  const ponder = project
    ? `What assumption in ${htmlEscape(project)} might “${htmlEscape(truncate(reflection, 80))}” change? Name the smallest experiment that would test it.`
    : `Which item in “${htmlEscape(truncate(reflection, 80))}” deserves 20 focused minutes, and what question will you try to answer before opening it?`;

  const reflectionPanels = [
    renderHtmlPanel(`Recall first${dueReviews.length ? ` · ${dueReviews.length} due` : ''}`, recall),
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

  contents.push({ title: 'Recall first', id: 'recall' }, { title: 'Ponder', id: 'ponder' });
  // Keep source diagnostics at the end, after all reading and reflection.
  const diagnostics = sections.pop() ?? '';
  sections.push(reflectionPanels, diagnostics);

  return renderReadingPage({
    title: `Daily Learning Review — ${collection.date}`,
    subtitle: `${collection.items.length} new saves · ${themes.length} themes · ${dueReviews.length} reviews due`,
    overview,
    contents,
    body: sections.join(''),
    footer: `Field Theory · ${htmlEscape(collection.date)}`,
  });
}

/** Exported for the digest writer and tests. */
export function digestHtmlItem(item: HtmlItem): string {
  return renderHtmlItem(item);
}
