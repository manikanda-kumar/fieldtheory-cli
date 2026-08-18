/**
 * Shared "what did I save here" text extraction for the daily digest.
 *
 * Both the themed item lines and the spaced-retrieval review cards need the
 * same thing: the most substantive prose already present in a canonical item's
 * indexed text, trimmed to a readable length at a sentence or word boundary.
 */

/** Fields the summarizer needs; satisfied by canonical items and review items. */
export interface SummarizableItem {
  displayTitle: string | null;
  searchText: string;
}

const compact = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * Trim to `maxChars` without cutting mid-word. A sentence end in the last
 * third of the budget wins (the text then reads as complete and needs no
 * ellipsis); otherwise cut at the last word boundary and mark the elision.
 */
export function truncateAtBoundary(value: string, maxChars: number): string {
  const text = compact(value);
  if (text.length <= maxChars) return text;
  const window = text.slice(0, maxChars);
  const sentenceEnd = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
    window.lastIndexOf('… '),
  );
  if (sentenceEnd >= Math.floor(maxChars * 0.6)) return window.slice(0, sentenceEnd + 1).trimEnd();
  const room = window.slice(0, maxChars - 1);
  const wordEnd = room.lastIndexOf(' ');
  const head = (wordEnd >= Math.floor(maxChars * 0.4) ? room.slice(0, wordEnd) : room).trimEnd();
  // Do not leave dangling punctuation in front of the ellipsis.
  return `${head.replace(/[,;:—–-]$/, '').trimEnd()}…`;
}

/** The best concise summary already present in an item's saved text. */
export function summarizeSavedText(item: SummarizableItem, maxChars: number): string {
  const truncate = (value: string): string => truncateAtBoundary(value, maxChars);
  const explicitSummary = item.searchText.match(/(?:^|\s)summary:\s*(.+)$/is)?.[1];
  if (explicitSummary) return truncate(compact(explicitSummary));

  const title = compact(item.displayTitle ?? '');
  // searchText is newline-joined index parts (title, body, topics, language,
  // owner, folder path, handles, domains). Lines under three words are almost
  // always that indexing metadata, not prose — drop them so summaries do not
  // end in keyword soup ("… TypeScript oxlint dmmulroy GitHub Stars").
  const seenLines = new Set<string>();
  const substantiveLines = item.searchText
    .replace(/https?:\/\/\S+/g, ' ')
    .split('\n')
    .map(compact)
    .filter((line) => {
      const words = line.split(' ').filter((word) => /[\p{L}\p{N}]/u.test(word));
      if (words.length < 3) return false;
      const key = line.toLowerCase();
      if (seenLines.has(key)) return false;
      seenLines.add(key);
      return true;
    });
  const text = substantiveLines.length > 0
    ? compact(substantiveLines.join(' '))
    : compact(item.searchText.replace(/https?:\/\/\S+/g, ' '));
  // Merged rows can repeat the title at the head of the text (title + source
  // text both carry it), so strip every leading occurrence, not just one.
  let withoutTitle = text;
  while (title && withoutTitle.toLowerCase().startsWith(title.toLowerCase())) {
    withoutTitle = withoutTitle.slice(title.length);
    // Titles truncated mid-word at index time leave a dangling fragment
    // ("…pus" → "h to get…") at the start; drop it at the word boundary.
    if (/^\S/.test(withoutTitle)) withoutTitle = withoutTitle.replace(/^\S+/, '');
    withoutTitle = withoutTitle.trim();
  }
  // Merged X/Raindrop rows can leave only an author handle, tweet id, and
  // domain after the post text (which is also the title) is removed. Repeat
  // the substantive title instead of presenting that indexing metadata as a
  // summary.
  const meaningfulRemainder = withoutTitle
    .replace(/\b\d{8,}\b/g, ' ')
    .replace(/\b(?:[\w-]+\.)+[a-z]{2,}\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return truncate(meaningfulRemainder.length >= 40 ? withoutTitle : title || text);
}
