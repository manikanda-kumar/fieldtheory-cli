/**
 * Rolling interest profile: mechanical (SQL + term counting) view of what the
 * user is into right now. Regenerated on every digest write; hard-capped at
 * 80 lines so agents can always afford to load it.
 */

import path from 'node:path';
import { openDb } from '../db.js';
import { pathExists, readJsonLines, writeMd } from '../fs.js';
import { libraryDir, twitterBookmarksIndexPath } from '../paths.js';
import { followingCachePath } from '../following/paths.js';
import { isFollowingSnapshotComplete } from '../following/db.js';
import { projectsCachePath } from '../projects/paths.js';
import type { ProjectRecord } from '../projects/types.js';

const RECENT_DAYS = 7;
const BASELINE_DAYS = 30;
const MAX_LINES = 80;

/**
 * Generic dev/agent vocabulary: present in most prompts and titles, so even
 * high counts carry no interest signal. Filters standalone thread terms;
 * bigrams keep one stop side ("claude code") but never both ("writing code").
 */
const THREAD_STOPTERMS = new Set([
  'agent', 'agents', 'assistant', 'assistants', 'code', 'codes', 'coding', 'coder',
  'writing', 'write', 'writes', 'written', 'thing', 'things', 'process', 'processes',
  'engine', 'engines', 'using', 'used', 'uses', 'make', 'makes', 'making', 'made',
  'need', 'needs', 'needed', 'want', 'wants', 'wanted', 'work', 'works', 'working',
  'build', 'builds', 'building', 'built', 'run', 'runs', 'running', 'question',
  'questions', 'help', 'file', 'files', 'folder', 'project', 'projects', 'task',
  'tasks', 'test', 'tests', 'testing', 'error', 'errors', 'issue', 'issues',
  'good', 'better', 'best', 'right', 'sure', 'look', 'looks', 'looking', 'check',
  'checks', 'checked', 'update', 'updates', 'updated', 'change', 'changes', 'changed',
  'time', 'times', 'data', 'line', 'lines', 'page', 'pages', 'item', 'items',
  'list', 'lists', 'name', 'names', 'user', 'users', 'thanks', 'please', 'also',
  'model', 'models', 'output', 'outputs', 'input', 'inputs', 'below', 'above',
  'explain', 'explains', 'explained', 'result', 'results', 'response', 'responses',
  'prompt', 'prompts', 'summary', 'example', 'examples', 'detail', 'details',
  'section', 'sections', 'version', 'versions', 'option', 'options', 'long', 'short',
  'exactly', 'asked', 'asking', 'said', 'tell', 'tells', 'telling', 'told',
  'give', 'gives', 'giving', 'given', 'show', 'shows', 'showing', 'shown',
  'find', 'finds', 'finding', 'found', 'know', 'knows', 'knowing', 'known',
  'keep', 'keeps', 'keeping', 'kept', 'start', 'starts', 'starting', 'started',
]);

/** Function words never useful in any position, including inside bigrams. */
const BIGRAM_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'these', 'those', 'have',
  'has', 'had', 'was', 'were', 'are', 'is', 'be', 'been', 'being', 'will', 'would',
  'could', 'should', 'can', 'may', 'might', 'must', 'not', 'but', 'you', 'your',
  'our', 'their', 'its', 'his', 'her', 'them', 'they', 'what', 'when', 'where',
  'which', 'who', 'why', 'how', 'about', 'into', 'over', 'under', 'than', 'then',
  'there', 'here', 'some', 'more', 'most', 'very', 'just', 'like', 'only', 'all',
  'any', 'each', 'other', 'out', 'now', 'new', 'one', 'two', 'get', 'got', 'does',
  'doing', 'done', 'dont', 'cant', 'lets', 'http', 'https', 'www', 'com',
  'nothing', 'something', 'anything', 'everything', 'nobody', 'somebody',
  'anybody', 'everybody', 'none', 'else', 'every', 'always', 'never', 'still',
  'already', 'again', 'though', 'maybe', 'actually', 'really', 'probably',
  'currently', 'instead', 'because', 'before', 'after', 'while', 'without',
]);

/**
 * Thread terms for one text: specificity-filtered unigrams plus adjacent-word
 * bigrams. Bigrams survive one generic side ("claude code") but not two.
 */
export function interestThreadTerms(text: string): string[] {
  const tokens = text.toLowerCase().split(/[^a-z0-9_]+/)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token) && !BIGRAM_STOPWORDS.has(token));
  const terms: string[] = [];
  for (const token of tokens) {
    if (token.length < 4 || THREAD_STOPTERMS.has(token)) continue;
    if (!terms.includes(token)) terms.push(token);
    if (terms.length >= 20) break;
  }
  for (let i = 0; i + 1 < tokens.length && terms.length < 40; i += 1) {
    if (THREAD_STOPTERMS.has(tokens[i]) && THREAD_STOPTERMS.has(tokens[i + 1])) continue;
    const bigram = `${tokens[i]} ${tokens[i + 1]}`;
    if (!terms.includes(bigram)) terms.push(bigram);
  }
  return terms;
}

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

function inWindowMs(value: unknown, sinceMs: number, untilMs: number): boolean {
  if (value == null) return false;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) && ms >= sinceMs && ms < untilMs;
}

async function topicCounts(sinceIso: string, untilIso: string): Promise<Map<string, number>> {
  const db = await openDb(twitterBookmarksIndexPath());
  const counts = new Map<string, number>();
  const sinceMs = Date.parse(sinceIso);
  const untilMs = Date.parse(untilIso);
  try {
    // first_saved_at mixes ISO and Twitter-format strings — filter in JS.
    const rows = db.exec(
      `SELECT primary_category, primary_domain, first_saved_at FROM canonical_bookmarks
       WHERE first_saved_at IS NOT NULL`,
    );
    for (const row of rows[0]?.values ?? []) {
      if (!inWindowMs(row[2], sinceMs, untilMs)) continue;
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
  const sinceMs = Date.parse(sinceIso);
  try {
    const rows = db.exec(
      `SELECT display_title, substr(search_text, 1, 400), first_saved_at FROM canonical_bookmarks
       WHERE first_saved_at IS NOT NULL`,
    );
    for (const row of rows[0]?.values ?? []) {
      if (!inWindowMs(row[2], sinceMs, Number.POSITIVE_INFINITY)) continue;
      const terms = interestThreadTerms(`${row[0] ?? ''} ${row[1] ?? ''}`);
      for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  } catch {
    // Missing schema tolerated.
  } finally {
    db.close();
  }
  return counts;
}

async function promptTerms(sinceIso: string): Promise<{ counts: Map<string, number>; totalPrompts: number }> {
  const counts = new Map<string, number>();
  const cachePath = projectsCachePath();
  if (!(await pathExists(cachePath))) return { counts, totalPrompts: 0 };

  const sinceMs = Date.parse(sinceIso);
  const records = await readJsonLines<ProjectRecord>(cachePath);
  // Repeated identical prompts (agent loops, resumed sessions) would otherwise
  // multiply their terms into fake "asked 50×" threads.
  const seenPrompts = new Set<string>();
  for (const record of records) {
    for (const prompt of record.recentPrompts ?? []) {
      const ms = Date.parse(prompt.timestamp);
      if (!Number.isFinite(ms) || ms < sinceMs) continue;
      const normalized = prompt.text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (seenPrompts.has(normalized)) continue;
      seenPrompts.add(normalized);
      for (const term of interestThreadTerms(prompt.text)) {
        counts.set(term, (counts.get(term) ?? 0) + 1);
      }
    }
  }
  return { counts, totalPrompts: seenPrompts.size };
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
  const { counts: prompts, totalPrompts } = await promptTerms(recentSince);
  // Bigrams outrank unigrams: "context engineering" is a thread, "context" is noise.
  const isBigram = (term: string): number => (term.includes(' ') ? 1 : 0);
  // A unigram in over a quarter of all prompts is prompt boilerplate, not an
  // interest; specific bigrams are exempt.
  const boilerplateCap = totalPrompts >= 8 ? Math.max(2, Math.ceil(totalPrompts * 0.25)) : Number.POSITIVE_INFINITY;
  const threads = [...prompts.entries()]
    .filter(([term, count]) => count >= 2 && (consumption.get(term) ?? 0) >= 2)
    .filter(([term, count]) => isBigram(term) === 1 || count <= boilerplateCap)
    .map(([term, promptCount]) => ({ term, consumptionCount: consumption.get(term) ?? 0, promptCount }))
    .sort((a, b) => (isBigram(b.term) - isBigram(a.term))
      || (b.consumptionCount + b.promptCount) - (a.consumptionCount + a.promptCount))
    .slice(0, 8);

  const experts: InterestsData['experts'] = [];
  const followingPath = followingCachePath();
  if (await isFollowingSnapshotComplete() && await pathExists(followingPath)) {
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
