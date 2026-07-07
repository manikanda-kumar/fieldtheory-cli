/**
 * Rolling interest profile: mechanical (SQL + term counting) view of what the
 * user is into right now. Regenerated on every digest write; hard-capped at
 * 80 lines so agents can always afford to load it.
 */

import path from 'node:path';
import { openDb } from '../db.js';
import { pathExists, readJsonLines, writeMd } from '../fs.js';
import { libraryDir, twitterBookmarksIndexPath } from '../paths.js';
import { relatedSeedTerms } from '../canonical-bookmarks-db.js';
import { followingCachePath } from '../following/paths.js';
import { projectsCachePath } from '../projects/paths.js';
import type { ProjectRecord } from '../projects/types.js';

const RECENT_DAYS = 7;
const BASELINE_DAYS = 30;
const MAX_LINES = 80;

export interface TopicVelocity {
  topic: string;
  recentCount: number;
  baselineWeekly: number;
}

export interface InterestsData {
  generatedAt: string;
  rising: TopicVelocity[];
  steady: TopicVelocity[];
  fading: TopicVelocity[];
  threads: { term: string; consumptionCount: number; promptCount: number }[];
  experts: { handle: string; name?: string; domains: string[] }[];
}

interface FollowingRecordLike {
  handle?: string;
  name?: string;
  domains?: string[];
}

export function interestsMarkdownPath(): string {
  return path.join(libraryDir(), 'interests.md');
}

async function topicCounts(sinceIso: string, untilIso: string): Promise<Map<string, number>> {
  const db = await openDb(twitterBookmarksIndexPath());
  const counts = new Map<string, number>();
  try {
    const rows = db.exec(
      `SELECT primary_category, primary_domain FROM canonical_bookmarks
       WHERE first_saved_at >= ? AND first_saved_at < ?`,
      [sinceIso, untilIso],
    );
    for (const row of rows[0]?.values ?? []) {
      for (const value of [row[0], row[1]]) {
        if (value == null) continue;
        const topic = String(value).trim().toLowerCase();
        // Skip non-topics: empty, catch-all buckets, and website hostnames
        // (primary_domain holds values like "youtube.com" for some sources).
        if (!topic || topic === 'general' || topic === 'unclassified' || topic.includes('.')) continue;
        counts.set(topic, (counts.get(topic) ?? 0) + 1);
      }
    }
  } catch {
    // Canonical tables may not exist yet — empty profile is fine.
  } finally {
    db.close();
  }
  return counts;
}

async function recentItemTerms(sinceIso: string): Promise<Map<string, number>> {
  const db = await openDb(twitterBookmarksIndexPath());
  const counts = new Map<string, number>();
  try {
    const rows = db.exec(
      `SELECT display_title, substr(search_text, 1, 400) FROM canonical_bookmarks
       WHERE first_saved_at >= ?`,
      [sinceIso],
    );
    for (const row of rows[0]?.values ?? []) {
      const terms = relatedSeedTerms(`${row[0] ?? ''} ${row[1] ?? ''}`, 20);
      for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  } catch {
    // Missing schema tolerated.
  } finally {
    db.close();
  }
  return counts;
}

async function promptTerms(sinceIso: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const cachePath = projectsCachePath();
  if (!(await pathExists(cachePath))) return counts;

  const records = await readJsonLines<ProjectRecord>(cachePath);
  for (const record of records) {
    for (const prompt of record.recentPrompts ?? []) {
      if (prompt.timestamp < sinceIso) continue;
      for (const term of relatedSeedTerms(prompt.text, 20)) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export async function computeInterests(now: Date = new Date()): Promise<InterestsData> {
  const recentSince = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const baselineSince = new Date(now.getTime() - (RECENT_DAYS + BASELINE_DAYS) * 24 * 60 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  const recent = await topicCounts(recentSince, nowIso);
  const baseline = await topicCounts(baselineSince, recentSince);

  const topics = new Set([...recent.keys(), ...baseline.keys()]);
  const rising: TopicVelocity[] = [];
  const steady: TopicVelocity[] = [];
  const fading: TopicVelocity[] = [];

  for (const topic of topics) {
    const recentCount = recent.get(topic) ?? 0;
    const baselineWeekly = ((baseline.get(topic) ?? 0) / BASELINE_DAYS) * 7;
    const entry = { topic, recentCount, baselineWeekly: Math.round(baselineWeekly * 10) / 10 };
    if (recentCount >= 3 && recentCount >= baselineWeekly * 1.5) rising.push(entry);
    else if (recentCount <= baselineWeekly * 0.5 && baselineWeekly >= 3) fading.push(entry);
    else if (recentCount >= 2) steady.push(entry);
  }
  rising.sort((a, b) => b.recentCount - a.recentCount);
  steady.sort((a, b) => b.recentCount - a.recentCount);
  fading.sort((a, b) => b.baselineWeekly - a.baselineWeekly);

  const consumption = await recentItemTerms(recentSince);
  const prompts = await promptTerms(recentSince);
  const threads = [...prompts.entries()]
    .filter(([term, count]) => count >= 2 && (consumption.get(term) ?? 0) >= 2)
    .map(([term, promptCount]) => ({ term, consumptionCount: consumption.get(term) ?? 0, promptCount }))
    .sort((a, b) => (b.consumptionCount + b.promptCount) - (a.consumptionCount + a.promptCount))
    .slice(0, 8);

  const experts: InterestsData['experts'] = [];
  const followingPath = followingCachePath();
  if (await pathExists(followingPath)) {
    const risingTopics = rising.slice(0, 6).map((entry) => entry.topic);
    const records = await readJsonLines<FollowingRecordLike>(followingPath);
    for (const record of records) {
      if (!record.handle || !record.domains?.length) continue;
      const domains = record.domains.map((domain) => domain.toLowerCase());
      if (risingTopics.some((topic) => domains.some((domain) => domain.includes(topic) || topic.includes(domain)))) {
        experts.push({ handle: record.handle, name: record.name, domains: record.domains });
        if (experts.length >= 5) break;
      }
    }
  }

  return { generatedAt: nowIso, rising: rising.slice(0, 8), steady: steady.slice(0, 8), fading: fading.slice(0, 5), threads, experts };
}

export function renderInterestsMarkdown(data: InterestsData): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push(`generated_at: "${data.generatedAt}"`);
  lines.push('---');
  lines.push('');
  lines.push('# Current Interests');
  lines.push('');

  const velocityLine = (entry: TopicVelocity): string =>
    `- ${entry.topic} — ${entry.recentCount} this week (was ~${entry.baselineWeekly}/wk)`;

  if (data.rising.length > 0) {
    lines.push('## Rising');
    for (const entry of data.rising) lines.push(velocityLine(entry));
    lines.push('');
  }
  if (data.threads.length > 0) {
    lines.push('## Active threads (reading AND asking about)');
    for (const thread of data.threads) {
      lines.push(`- ${thread.term} — ${thread.consumptionCount} saves, ${thread.promptCount} agent questions this week`);
    }
    lines.push('');
  }
  if (data.steady.length > 0) {
    lines.push('## Steady');
    for (const entry of data.steady) lines.push(velocityLine(entry));
    lines.push('');
  }
  if (data.fading.length > 0) {
    lines.push('## Fading');
    for (const entry of data.fading) lines.push(velocityLine(entry));
    lines.push('');
  }
  if (data.experts.length > 0) {
    lines.push('## Experts to ask (following, matching rising topics)');
    for (const expert of data.experts) {
      lines.push(`- @${expert.handle}${expert.name ? ` (${expert.name})` : ''} — ${expert.domains.join(', ')}`);
    }
    lines.push('');
  }
  if (lines.length <= 6) {
    lines.push('No signal yet — profile fills in as daily digests accumulate.');
  }

  return lines.slice(0, MAX_LINES).join('\n');
}

export async function writeInterests(now: Date = new Date()): Promise<{ path: string; data: InterestsData }> {
  const data = await computeInterests(now);
  const outPath = interestsMarkdownPath();
  await writeMd(outPath, renderInterestsMarkdown(data));
  return { path: outPath, data };
}
