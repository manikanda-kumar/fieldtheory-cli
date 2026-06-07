export type ListTimelineKind = 'list-tweet' | 'conversation-context' | 'unknown';

export interface ListTimelinePageItem {
  timelineKind: ListTimelineKind;
  postedAt?: string | null;
}

export interface QuotedOriginalDedupeItem {
  id: string;
  quotedTweetId?: string;
}

export function classifyListTimelineEntry(entryId: string | undefined): ListTimelineKind {
  if (entryId?.startsWith('tweet-')) return 'list-tweet';
  if (entryId?.startsWith('list-conversation-')) return 'conversation-context';
  return 'unknown';
}

export function mergeTimelineKind(
  existing: ListTimelineKind | undefined,
  incoming: ListTimelineKind
): ListTimelineKind {
  if (existing === 'list-tweet' || incoming === 'list-tweet') return 'list-tweet';
  if (existing === 'conversation-context' || incoming === 'conversation-context') return 'conversation-context';
  return 'unknown';
}

export function isWithinSinceHours(
  postedAt: string | null | undefined,
  sinceHours: number | undefined,
  nowMs: number = Date.now()
): boolean {
  if (sinceHours === undefined) return true;
  const postedAtMs = Date.parse(postedAt ?? '');
  if (!Number.isFinite(postedAtMs)) return true;
  return postedAtMs >= nowMs - sinceHours * 60 * 60 * 1000;
}

export function shouldStopAfterPage(
  items: ListTimelinePageItem[],
  sinceHours: number | undefined,
  nowMs: number = Date.now()
): boolean {
  if (sinceHours === undefined) return false;
  const listTweetItems = items.filter((item) => item.timelineKind === 'list-tweet');
  if (listTweetItems.length === 0) return false;
  return listTweetItems.every((item) => !isWithinSinceHours(item.postedAt, sinceHours, nowMs));
}

export function dropQuotedOriginals<T extends QuotedOriginalDedupeItem>(items: T[]): T[] {
  const quotedOriginalIds = new Set(items.map((item) => item.quotedTweetId).filter((id): id is string => Boolean(id)));
  return items.filter((item) => !quotedOriginalIds.has(item.id));
}
