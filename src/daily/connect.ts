/**
 * Daily synthesis connection pass: link each newly collected item to its most
 * related older items via canonical FTS. Pure SQL — no LLM involved.
 */

import { findRelatedCanonicalBookmarks } from '../canonical-bookmarks-db.js';
import type { CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import type { DailyCollection } from './collect.js';

const SEED_TEXT_CHARS = 300;
const RELATED_PER_ITEM = 3;

export interface RelatedRef {
  id: string;
  title: string | null;
  url: string | null;
  score: number;
}

export interface ConnectedItem {
  item: CanonicalRecentItem;
  related: RelatedRef[];
}

function seedTextFor(item: CanonicalRecentItem): string {
  const title = item.displayTitle ?? '';
  const body = item.searchText.slice(0, SEED_TEXT_CHARS);
  return `${title}\n${body}`;
}

export async function connectDailyItems(collection: DailyCollection): Promise<ConnectedItem[]> {
  const excludeIds = collection.items.map((item) => item.id);
  const connected: ConnectedItem[] = [];

  for (const item of collection.items) {
    const related = await findRelatedCanonicalBookmarks(seedTextFor(item), {
      excludeIds,
      beforeIso: collection.sinceIso,
      limit: RELATED_PER_ITEM,
    });
    connected.push({
      item,
      related: related.map((hit) => ({
        id: hit.id,
        title: hit.displayTitle,
        url: hit.canonicalUrl,
        score: hit.score,
      })),
    });
  }

  return connected;
}
