/**
 * Durable, deliberately small spaced-retrieval queue for the daily digest.
 * Cards point back to original saved material; they are prompts to retrieve,
 * not a second copy of the user's library.
 */

import { pathExists, readJson, writeJson } from '../fs.js';
import { dailyReviewPath, ensureDailyDir } from './paths.js';

const MAX_NEW_CARDS_PER_DIGEST = 3;
const ANSWER_CHARS = 360;
const GOT_IT_INTERVALS = [3, 7, 14, 30, 60, 120];

export type ReviewRating = 'again' | 'fuzzy' | 'got-it';

export interface ReviewCard {
  id: string;
  canonicalId: string;
  title: string;
  url: string | null;
  prompt: string;
  answer: string;
  sources: string[];
  savedAt: string | null;
  createdAt: string;
  dueAt: string;
  intervalDays: number;
  reviewCount: number;
  lastReviewedAt?: string;
  lastRating?: ReviewRating;
}

export interface ReviewableItem {
  id: string;
  canonicalUrl: string | null;
  displayTitle: string | null;
  searchText: string;
  sources: string[];
  firstSavedAt: string | null;
}

interface ReviewState {
  version: 1;
  cards: ReviewCard[];
}

function cleanText(value: string): string {
  return value.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
}

function titleFor(item: ReviewableItem): string {
  return (item.displayTitle ?? item.canonicalUrl ?? item.id).replace(/\s+/g, ' ').trim().slice(0, 120);
}

function datePlusDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function readReviewCards(): Promise<ReviewCard[]> {
  const file = dailyReviewPath();
  if (!(await pathExists(file))) return [];
  try {
    const state = await readJson<ReviewState>(file);
    return Array.isArray(state.cards) ? state.cards.filter((card) => card && typeof card.id === 'string') : [];
  } catch {
    return [];
  }
}

async function writeReviewCards(cards: ReviewCard[]): Promise<void> {
  ensureDailyDir();
  await writeJson(dailyReviewPath(), { version: 1, cards } satisfies ReviewState);
}

/** Return a short, oldest-first daily review queue. */
export async function listDueReviewCards(now: Date = new Date(), limit = 3): Promise<ReviewCard[]> {
  const nowMs = now.getTime();
  return (await readReviewCards())
    .filter((card) => Date.parse(card.dueAt) <= nowMs)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt) || a.createdAt.localeCompare(b.createdAt))
    .slice(0, Math.max(1, limit));
}

export async function getReviewCard(id: string): Promise<ReviewCard | null> {
  return (await readReviewCards()).find((card) => card.id === id) ?? null;
}

/**
 * Create at most three cards per digest, biased toward substantive text.
 * New cards are first due tomorrow; today's report only asks about prior saves.
 */
export async function queueReviewCards(
  items: ReviewableItem[],
  now: Date = new Date(),
  options: { initialDelayDays?: number; maxCards?: number } = {},
): Promise<{ added: number; total: number }> {
  const existing = await readReviewCards();
  const known = new Set(existing.map((card) => card.canonicalId));
  const candidates = [...items]
    .filter((item) => !known.has(item.id))
    .sort((a, b) => cleanText(b.searchText).length - cleanText(a.searchText).length || a.id.localeCompare(b.id))
    .slice(0, options.maxCards ?? MAX_NEW_CARDS_PER_DIGEST);

  const createdAt = now.toISOString();
  const additions = candidates.map((item): ReviewCard => {
    const title = titleFor(item);
    const answer = cleanText(item.searchText).slice(0, ANSWER_CHARS) || title;
    return {
      id: `review:${item.id}`,
      canonicalId: item.id,
      title,
      url: item.canonicalUrl,
      prompt: `Without opening it, what problem, claim, or technique made you save “${title}”?`,
      answer,
      sources: item.sources,
      savedAt: item.firstSavedAt,
      createdAt,
      dueAt: datePlusDays(now, options.initialDelayDays ?? 1),
      intervalDays: Math.max(1, options.initialDelayDays ?? 1),
      reviewCount: 0,
    };
  });
  if (additions.length > 0) await writeReviewCards([...existing, ...additions]);
  return { added: additions.length, total: existing.length + additions.length };
}

export async function gradeReviewCard(
  id: string,
  rating: ReviewRating,
  now: Date = new Date(),
): Promise<ReviewCard | null> {
  const cards = await readReviewCards();
  const index = cards.findIndex((card) => card.id === id);
  if (index < 0) return null;
  const card = cards[index];
  const intervalDays = rating === 'again'
    ? 1
    : rating === 'fuzzy'
      ? Math.max(2, Math.ceil(card.intervalDays / 2))
      : GOT_IT_INTERVALS[Math.min(card.reviewCount, GOT_IT_INTERVALS.length - 1)];
  const updated: ReviewCard = {
    ...card,
    intervalDays,
    dueAt: datePlusDays(now, intervalDays),
    reviewCount: card.reviewCount + 1,
    lastReviewedAt: now.toISOString(),
    lastRating: rating,
  };
  cards[index] = updated;
  await writeReviewCards(cards);
  return updated;
}

export function formatReviewPrompt(card: ReviewCard): string {
  const saved = card.savedAt ? card.savedAt.slice(0, 10) : 'unknown date';
  return `${card.id}\n  ${card.prompt}\n  Saved: ${saved} · source: ${card.sources.join(', ') || 'unknown'}\n  Reveal: ft review show ${card.id}\n  Grade:  ft review grade ${card.id} again|fuzzy|got-it`;
}
