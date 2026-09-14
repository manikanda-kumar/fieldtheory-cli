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
