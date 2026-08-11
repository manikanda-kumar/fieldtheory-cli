/**
 * Markdown metadata extraction shared by the navigation commands and the
 * library document index. Frontmatter tags, inline `#tags`, and `[[wiki links]]`.
 */

export function parseFrontmatterTags(content: string): string[] {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!match) return [];
  const yaml = match[1];
  const tags: string[] = [];
  const inline = /^tags:\s*(.+)$/im.exec(yaml);
  if (inline) {
    const raw = inline[1].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      tags.push(...raw.slice(1, -1).split(',').map((tag) => tag.trim().replace(/^["']|["']$/g, '')));
    } else if (!raw.startsWith('|')) {
      tags.push(...raw.split(/[,\s]+/).map((tag) => tag.trim()));
    }
  }
  const block = /^tags:\s*\n((?:\s*-\s*.+\n?)+)/im.exec(yaml);
  if (block) {
    tags.push(...block[1].split('\n').map((line) => line.replace(/^\s*-\s*/, '').trim()));
  }
  return tags.map((tag) => tag.replace(/^#/, '')).filter(Boolean);
}

export function extractInlineTags(content: string): string[] {
  const tags = new Set<string>();
  for (const match of content.matchAll(/(?:^|[\s(])#([A-Za-z][A-Za-z0-9_-]*)\b/gm)) {
    tags.add(match[1]);
  }
  return [...tags];
}

export function extractWikiLinks(content: string): string[] {
  const counts = new Map<string, number>();
  for (const match of content.matchAll(/\[\[([^\]\n|]+)(?:\|[^\]\n]+)?\]\]/g)) {
    const target = match[1].trim();
    counts.set(target, (counts.get(target) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([target]) => target);
}

/** Frontmatter tags plus inline `#tags`, deduped and sorted. */
export function collectDocumentTags(content: string): string[] {
  return [...new Set([...parseFrontmatterTags(content), ...extractInlineTags(content)])].sort();
}
