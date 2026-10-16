/** Decode saved text before escaping it again for display. */
export function decodeReadingText(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
  return value.replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, entity: string) => named[entity]);
}

/** Move embedded web URLs out of reading prose without losing their targets. */
export function separateReadingLinks(value: string): { text: string; urls: string[] } {
  const urls: string[] = [];
  const text = decodeReadingText(value).replace(/https?:\/\/[^\s<>"“”]+/gi, (match) => {
    let url = match;
    let punctuation = '';
    while (/[.,;:!?\]\}'’]$/.test(url) || (url.endsWith(')') && (url.match(/\)/g)?.length ?? 0) > (url.match(/\(/g)?.length ?? 0))) {
      punctuation = url.slice(-1) + punctuation;
      url = url.slice(0, -1);
    }
    // An already truncated URL is not a usable destination; the entry's
    // canonical source link still provides a route back to the original.
    if (!url.endsWith('…') && !urls.includes(url)) urls.push(url);
    return punctuation;
  }).replace(/\(\s*\)/g, '').replace(/\s+([,.;!?])/g, '$1').replace(/\s+/g, ' ').trim();
  return { text, urls };
}

export function readingSourceLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') || 'Read source'; }
  catch { return 'Read source'; }
}

/** WordPress feed footer that saved RSS text carries into item excerpts. */
export function stripFeedFooter(value: string): string {
  return value.replace(/\s*The post .+? appeared first on .+?\.$/, '');
}

/**
 * Link roundups ("1. A. 2. B. 3. C.") arrive flattened onto one line. Split
 * on markers that count up from 1 and follow a sentence end, so a stray
 * "version 2. " inside an item does not start a new one.
 */
export function splitInlineNumberedList(line: string): string[] | null {
  if (!/^1[.)] /.test(line)) return null;
  const starts = [0];
  let next = 2;
  for (;;) {
    const marker = new RegExp(`(?<=[.?!)\\]"'”’…])\\s+${next}[.)] `, 'g');
    marker.lastIndex = starts[starts.length - 1] + 3;
    const match = marker.exec(line);
    if (!match) break;
    starts.push(match.index);
    next += 1;
  }
  if (starts.length < 2) return null;
  return starts.map((start, index) =>
    line.slice(start, starts[index + 1] ?? line.length).trim().replace(/^\d{1,3}[.)] /, ''),
  );
}
