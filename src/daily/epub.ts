/**
 * Kindle/e-reader EPUB for the daily digest.
 *
 * Source of truth is the digest markdown already on disk, so any past day can
 * be re-exported without re-running synthesis. The conversion is deliberately
 * reading-optimized rather than a faithful mirror: the terminal machinery
 * (`ft review grade …` lines, canonical ids, the System details/coverage
 * block) is dropped, `<details>` reveals become inline boxes an e-reader can
 * render, and links that point at local files rather than the web degrade to
 * plain text.
 */

import { renderTextCover } from '../cover.js';
import { buildEpub, xmlEscape, type EpubChapter } from '../epub.js';
import { cleanDisplayUrl } from '../url-normalize.js';

export interface DigestEpubOptions {
  /** Overrides the date parsed from the markdown front matter. */
  date?: string;
  author?: string;
}

export interface DigestEpubResult {
  epub: Buffer;
  date: string;
  title: string;
  chapters: Array<{ id: string; title: string }>;
}

/** Sections that exist for the terminal, not for reading on a device. */
const DROPPED_SECTIONS = new Set(['system details']);
/** Marks the start of the theme run; carries no content of its own. */
const MATERIAL_DIVIDER = "today's material";

interface Section {
  title: string;
  lines: string[];
}

export function digestMarkdownToEpub(markdown: string, options: DigestEpubOptions = {}): DigestEpubResult {
  const { body, frontMatter } = splitFrontMatter(markdown);
  const date = options.date ?? frontMatter.get('date')?.replace(/"/g, '') ?? 'unknown';
  const lines = body.split('\n');

  let docTitle = `Daily Learning Review — ${date}`;
  const intro: string[] = [];
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    const h1 = /^# (.+)$/.exec(line);
    if (h1) {
      docTitle = h1[1].trim();
      continue;
    }
    const h2 = /^## (.+)$/.exec(line);
    if (h2) {
      current = { title: h2[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else intro.push(line);
  }

  const chapters: EpubChapter[] = [];
  const openerBody = renderBlocks(intro);
  chapters.push({
    id: 'ch-000-cover',
    title: docTitle,
    body: `  <h1>${xmlEscape(docTitle)}</h1>\n${openerBody}${renderSummaryList(frontMatter)}`,
  });

  let themeIndex = 0;
  let inThemes = false;
  for (const section of sections) {
    const key = section.title.toLowerCase();
    if (DROPPED_SECTIONS.has(key)) continue;
    if (key === MATERIAL_DIVIDER) {
      inThemes = true;
      continue;
    }
    if (key === 'also saved' || key === 'project activity') inThemes = false;

    const bodyMarkup = renderBlocks(section.lines);
    if (!bodyMarkup.trim()) continue;
    const id = inThemes
      ? `ch-${String(chapters.length).padStart(3, '0')}-theme-${(themeIndex += 1)}`
      : `ch-${String(chapters.length).padStart(3, '0')}-${slug(section.title)}`;
    chapters.push({
      id,
      title: section.title,
      body: `  <h1>${xmlEscape(section.title)}</h1>\n${bodyMarkup}`,
    });
  }

  const epub = buildEpub({
    title: docTitle,
    author: options.author ?? 'Field Theory',
    identifier: `urn:fieldtheory:daily:${date}`,
    date,
    // Open past the cover strip, on the first section that asks something.
    startChapterId: (chapters[1] ?? chapters[0]).id,
    // The date is what tells one issue from the next in a Kindle library grid.
    cover: {
      data: renderTextCover({ eyebrow: 'Field Theory', headline: date, lines: ['Daily', 'Review'] }),
      mediaType: 'image/png',
    },
    chapters,
  });

  return { epub, date, title: docTitle, chapters: chapters.map(({ id, title }) => ({ id, title })) };
}

function splitFrontMatter(markdown: string): { body: string; frontMatter: Map<string, string> } {
  const frontMatter = new Map<string, string>();
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(markdown);
  if (!match) return { body: markdown, frontMatter };
  for (const line of match[1].split('\n')) {
    const pair = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (pair) frontMatter.set(pair[1], pair[2].trim());
  }
  return { body: markdown.slice(match[0].length), frontMatter };
}

/** A one-line "what's in today's issue" strip under the cover heading. */
function renderSummaryList(frontMatter: Map<string, string>): string {
  const parts: string[] = [];
  const push = (key: string, label: string) => {
    const value = frontMatter.get(key);
    if (value && value !== '0') parts.push(`${value} ${label}`);
  };
  push('new_items', 'new saves');
  push('themes', 'themes');
  push('reviews_due', 'reviews due');
  const synthesis = frontMatter.get('synthesis');
  if (synthesis) parts.push(`${synthesis} synthesis`);
  return parts.length ? `  <p class="meta">${xmlEscape(parts.join(' · '))}</p>\n` : '';
}

/**
 * Markdown blocks → XHTML. Handles only what the digest renderer emits:
 * headings, paragraphs, blockquotes, bullet lists with indented summary
 * continuations, and `<details>` reveal blocks.
 */
function renderBlocks(lines: string[]): string {
  const out: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let quote: string[] = [];
  let reveal: { label: string; lines: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) out.push(`  <p>${inline(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushQuote = () => {
    if (quote.length) out.push(`  <blockquote><p>${inline(quote.join(' '))}</p></blockquote>`);
    quote = [];
  };
  const flushList = () => {
    if (listItems.length) out.push(`  <ul>\n${listItems.join('\n')}\n  </ul>`);
    listItems = [];
  };
  const flushAll = () => { flushParagraph(); flushQuote(); flushList(); };

  for (const raw of lines) {
    // ` · [notes](../youtube/…md)` points at a library file the book does not
    // carry, so the whole affordance goes rather than leaving a dangling word.
    const line = raw.replace(/\s*·\s*\[(?:local )?notes\]\((?!https?:)[^)]*\)/g, '').replace(/\s+$/, '');

    if (reveal) {
      if (/^<\/details>/.test(line)) {
        const text = reveal.lines.join(' ').trim();
        if (text) {
          out.push(`  <div class="reveal">\n    <p class="reveal-label">${inline(reveal.label)}</p>\n    <p>${inline(text)}</p>\n  </div>`);
        }
        reveal = null;
        continue;
      }
      const summary = /^<summary>(.*)<\/summary>$/.exec(line);
      if (summary) { reveal.label = summary[1]; continue; }
      if (line.trim()) reveal.lines.push(line.trim());
      continue;
    }

    if (/^<details>/.test(line)) { flushAll(); reveal = { label: 'Reveal', lines: [] }; continue; }
    // Terminal-only affordance: the grading command has no meaning on a Kindle.
    if (/^Grade after recalling:/.test(line)) { flushAll(); continue; }

    if (!line.trim()) { flushAll(); continue; }

    const heading = /^(#{3,6}) (.+)$/.exec(line);
    if (heading) {
      flushAll();
      const level = Math.min(6, heading[1].length - 1);
      out.push(`  <h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quote.push(line.replace(/^>\s?/, ''));
      continue;
    }
    flushQuote();

    const bullet = /^[-*] (.+)$/.exec(line);
    if (bullet) {
      flushParagraph();
      listItems.push(`    <li>${inline(bullet[1])}</li>`);
      continue;
    }

    // Two-space continuation under a bullet: the item's summary line.
    const continuation = /^ {2,}(\S.*)$/.exec(line);
    if (continuation && listItems.length) {
      const last = listItems.pop()!;
      listItems.push(last.replace(/<\/li>$/, `<p class="summary">${inline(continuation[1])}</p></li>`));
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushAll();
  return out.length ? `${out.join('\n')}\n` : '';
}

/** Inline markdown → XHTML, escaping first so raw markup cannot leak through. */
function inline(text: string): string {
  let value = xmlEscape(text);
  // Wiki-style project refs are a library affordance, not a link target.
  value = value.replace(/\[\[project:([^\]]+)\]\]/g, '$1');
  value = value.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
    const text = label || href;
    // Only web links survive: relative library paths resolve to nothing here.
    if (!/^https?:\/\//i.test(href)) return text;
    // Digests written before canonical URLs were cleaned still carry tracking
    // params, so strip them here too — the href arrives XML-escaped.
    const cleaned = cleanDisplayUrl(href.replace(/&amp;/g, '&'));
    return `<a href="${cleaned.replace(/&/g, '&amp;')}">${text}</a>`;
  });
  value = value.replace(/`([^`]+)`/g, '<code>$1</code>');
  value = value.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  value = value.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  return value;
}

function slug(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'section';
}
