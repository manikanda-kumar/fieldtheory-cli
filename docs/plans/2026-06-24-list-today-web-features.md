# List-Scoped Today Web Features Implementation Plan

> **For agentic workers:** Implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a curated “Today” experience to the Field Theory web UI using an X List as the source, then layer useful analysis surfaces on top of that list digest: Home, Analyze, Map, Sources, and Discuss.

**Architecture:** Reuse the existing `src/x-list-fetch.ts` GraphQL fetcher and `src/x-list-timeline.ts` timeline classification instead of adding a HomeTimeline fetch path. Persist list digests as local JSON under the existing `~/.fieldtheory/x-lists/` root, expose read-only web API routes from `src/web/server.ts`, and render new lanes in the existing dependency-free app shell. Keep the previous home-feed plan intact as an alternate future path.

**Tech Stack:** TypeScript NodeNext, existing `fetchXListDigest()`, existing `renderXListHtml()` card semantics, Node built-in HTTP server, JSONL/JSON local cache, vanilla browser JavaScript.

---

## Product direction

The most useful first “Today” is not the whole X home feed. It should be a curated list feed because:

- Field Theory already has a working authenticated X List GraphQL fetcher.
- X List IDs are explicit and stable compared with volatile HomeTimeline query discovery.
- Lists are lower-noise and better aligned with “daily intelligence digest” workflows.
- Existing list logic already separates direct list tweets from conversation context, filters by recency, drops duplicate quoted originals, extracts links/media/engagement, and writes JSON/HTML digests.

## Feature set

### 1. Home

Purpose: the landing dashboard for the local web app.

MVP contents:

- Today list summary: count, fetchedAt, sinceHours, pagesFetched, stopReason.
- Top links by source type: GitHub, YouTube, arXiv, Hugging Face, blogs, HN, papers.
- High-signal tweets: top by reposts, likes, replies, quotes, views, and recency.
- Quick actions: “Open Today”, “Open Bookmarks”, “Fetch list from CLI” instructions.

Deferred:

- Browser-triggered sync button. This needs a local per-process token and job progress API.

### 2. Today

Purpose: the main feed for a configured X List over a recent time window.

MVP contents:

- Cards from `XListHtmlTweet` shape.
- Filters: direct list tweets vs conversation context, link type, author, text query.
- Sort: recency, likes, reposts, replies, quotes, views.
- Detail drawer with quoted tweet, links, media, and engagement.

### 3. Analyze

Purpose: make the daily list digest useful without requiring an LLM first.

MVP contents:

- Link type distribution.
- Top domains.
- Top authors by post count and total engagement.
- “Unusual spikes”: tweets with engagement above the day’s median.
- Repeated topics via simple keyword/domain grouping.

Deferred:

- LLM-generated daily summary, cluster labels, and “why it matters”.

### 4. Map

Purpose: show relationships in the list digest.

MVP contents:

- Author → links graph data endpoint.
- Domain → tweets graph data endpoint.
- Lightweight SVG/DOM visualization in the browser.
- Click a node to filter Today.

Deferred:

- Force-directed canvas graph, community detection, temporal animation.

### 5. Sources

Purpose: turn list tweets into a source inbox.

MVP contents:

- Table of extracted links with source type, domain, title-ish URL label, tweet count, authors, and first/last seen.
- Filters by source type and domain.
- “Open original tweet” and “Open source URL”.

Deferred:

- Promote selected sources into canonical bookmarks.
- Fetch article text for list-linked sources.

### 6. Discuss

Purpose: provide a future conversational surface over today’s digest.

MVP contents:

- Not implemented as chat in this phase.
- Add an API-ready “context pack” endpoint that returns compact Today digest text: top tweets, links, domains, authors, and selected detail.
- Render copy buttons: “Copy digest context” and “Copy source context”.

Deferred:

- Local chat UI and LLM integration.
- Citations into Today cards and source rows.

---

## Data model

Use the existing `XListDigest` from `src/x-list-fetch.ts` as the source of truth:

```ts
export interface XListDigest {
  listId: string;
  fetchedAt: string;
  tweets: XListHtmlTweet[];
  rawPages: unknown[];
  stats: {
    count: number;
    fetchedCount: number;
    timeFilteredCount: number;
    quotedOriginalsDropped: number;
    pagesFetched: number;
    stopReason: string;
    nextCursor?: string;
    sinceHours?: number;
  };
}
```

Persist web-consumable digests without `rawPages`:

```ts
export interface StoredXListDigest {
  listId: string;
  fetchedAt: string;
  tweets: XListHtmlTweet[];
  stats: XListDigest['stats'];
}
```

The current CLI already writes equivalent JSON files into `~/.fieldtheory/x-lists/`. This plan adds stable read helpers over those files rather than creating a new cache root.

---

## File Structure

- Create `src/x-list-store.ts`: read latest/stamped list digest JSON, normalize stored digest shape, derive analytics, source rows, graph rows, and context packs.
- Modify `src/cli.ts`: optionally add `ft x-list --save-latest-json` only if existing default JSON output is not stable enough for web reads.
- Modify `src/web/server.ts`: add list-backed Today API routes.
- Modify `src/web/app-shell.ts`: add lanes and rendering for Home, Today, Analyze, Map, Sources, Discuss.
- Add `tests/x-list-store.test.ts`.
- Extend `tests/web-server.test.ts` for new API routes and app shell lane markers.

---

### Task 1: Add X List digest store/read helpers

**Files:**
- Create: `src/x-list-store.ts`
- Test: `tests/x-list-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Create `tests/x-list-store.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  buildTodayContextPack,
  deriveTodayAnalysis,
  deriveTodaySources,
  readLatestXListDigest,
} from '../src/x-list-store.js';

async function withTempRoot<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const previous = process.env.FT_DATA_DIR;
  const root = path.join(os.tmpdir(), `ft-x-list-store-${Date.now()}`);
  process.env.FT_DATA_DIR = root;
  try {
    await mkdir(path.join(root, '..', 'x-lists'), { recursive: true });
    return await fn(root);
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
  }
}

const digest = {
  listId: '197',
  fetchedAt: '2026-06-24T12:00:00.000Z',
  tweets: [
    {
      id: '1',
      timelineKind: 'list-tweet',
      url: 'https://x.com/alice/status/1',
      author: 'alice',
      authorName: 'Alice',
      postedAt: '2026-06-24T10:00:00.000Z',
      text: 'New agents paper https://arxiv.org/abs/1234.5678',
      links: ['https://arxiv.org/abs/1234.5678'],
      engagement: { likeCount: 10, repostCount: 4, replyCount: 2, quoteCount: 1, viewCount: 1000 },
    },
    {
      id: '2',
      timelineKind: 'conversation-context',
      url: 'https://x.com/bob/status/2',
      author: 'bob',
      authorName: 'Bob',
      postedAt: '2026-06-24T11:00:00.000Z',
      text: 'Repo release https://github.com/example/repo',
      links: ['https://github.com/example/repo'],
      engagement: { likeCount: 3, repostCount: 1, replyCount: 0, quoteCount: 0, viewCount: 200 },
    },
  ],
  stats: { count: 2, fetchedCount: 2, timeFilteredCount: 0, quotedOriginalsDropped: 0, pagesFetched: 1, stopReason: 'no-cursor', sinceHours: 24 },
};

test('readLatestXListDigest reads stable latest JSON for a list', async () => {
  await withTempRoot(async () => {
    const dir = path.join(os.homedir(), '.fieldtheory', 'x-lists');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, '197-latest.json'), JSON.stringify(digest));
    const result = await readLatestXListDigest('197');
    assert.equal(result?.listId, '197');
    assert.equal(result?.tweets.length, 2);
  });
});

test('deriveTodayAnalysis returns domains, authors, link types, and top tweets', () => {
  const analysis = deriveTodayAnalysis(digest);
  assert.equal(analysis.totalTweets, 2);
  assert.equal(analysis.linkTypes[0]?.type, 'arxiv');
  assert.equal(analysis.domains[0]?.domain, 'arxiv.org');
  assert.equal(analysis.authors[0]?.handle, 'alice');
  assert.equal(analysis.topTweets[0]?.id, '1');
});

test('deriveTodaySources groups links by URL and keeps author/tweet provenance', () => {
  const sources = deriveTodaySources(digest);
  assert.equal(sources.length, 2);
  assert.equal(sources[0]?.url, 'https://arxiv.org/abs/1234.5678');
  assert.deepEqual(sources[0]?.authors, ['alice']);
  assert.deepEqual(sources[0]?.tweetIds, ['1']);
});

test('buildTodayContextPack produces compact digest text', () => {
  const pack = buildTodayContextPack(digest);
  assert.match(pack, /X List 197/);
  assert.match(pack, /Top tweets/);
  assert.match(pack, /Sources/);
  assert.match(pack, /arxiv.org/);
});
```

- [ ] **Step 2: Run the tests and confirm missing module failure**

```bash
npm test -- tests/x-list-store.test.ts
```

Expected: module resolution failure for `../src/x-list-store.js`.

- [ ] **Step 3: Implement `src/x-list-store.ts`**

```ts
import path from 'node:path';
import { pathExists, readJson } from './fs.js';
import { xListsDir } from './paths.js';
import type { XListDigest } from './x-list-fetch.js';
import type { XListHtmlTweet } from './x-list-html.js';

export type StoredXListDigest = Omit<XListDigest, 'rawPages'>;

export interface CountRow {
  count: number;
}

export interface TodayAnalysis {
  listId: string;
  fetchedAt: string;
  totalTweets: number;
  listTweets: number;
  conversationContext: number;
  linkTypes: Array<{ type: string } & CountRow>;
  domains: Array<{ domain: string } & CountRow>;
  authors: Array<{ handle: string; name?: string; engagement: number } & CountRow>;
  topTweets: XListHtmlTweet[];
}

export interface TodaySourceRow {
  url: string;
  domain: string;
  type: string;
  count: number;
  authors: string[];
  tweetIds: string[];
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
}

export async function readLatestXListDigest(listId: string): Promise<StoredXListDigest | null> {
  const file = path.join(xListsDir(), `${listId}-latest.json`);
  if (!(await pathExists(file))) return null;
  const digest = await readJson<StoredXListDigest>(file);
  return {
    listId: String(digest.listId),
    fetchedAt: String(digest.fetchedAt),
    tweets: Array.isArray(digest.tweets) ? digest.tweets : [],
    stats: digest.stats,
  };
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function compactRows<K extends string>(map: Map<string, number>, key: K): Array<Record<K, string> & CountRow> {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ [key]: name, count }) as Record<K, string> & CountRow);
}

export function linkType(url: string): string {
  const domain = linkDomain(url);
  if (domain === 'github.com' || domain.endsWith('.github.com')) return 'github';
  if (domain === 'arxiv.org') return 'arxiv';
  if (domain === 'youtube.com' || domain === 'youtu.be') return 'youtube';
  if (domain === 'huggingface.co') return 'huggingface';
  if (domain === 'news.ycombinator.com') return 'hn';
  if (domain.includes('substack.com') || domain === 'medium.com') return 'blog';
  return domain || 'link';
}

export function linkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function engagement(tweet: XListHtmlTweet): number {
  const e = tweet.engagement;
  return (e?.likeCount ?? 0) + (e?.repostCount ?? 0) * 3 + (e?.replyCount ?? 0) * 2 + (e?.quoteCount ?? 0) * 3 + Math.round((e?.viewCount ?? 0) / 1000);
}

export function deriveTodayAnalysis(digest: StoredXListDigest): TodayAnalysis {
  const linkTypes = new Map<string, number>();
  const domains = new Map<string, number>();
  const authorCounts = new Map<string, { count: number; name?: string; engagement: number }>();

  for (const tweet of digest.tweets) {
    const handle = tweet.author ?? 'unknown';
    const previous = authorCounts.get(handle) ?? { count: 0, name: tweet.authorName, engagement: 0 };
    authorCounts.set(handle, { count: previous.count + 1, name: previous.name ?? tweet.authorName, engagement: previous.engagement + engagement(tweet) });
    for (const link of tweet.links ?? []) {
      increment(linkTypes, linkType(link));
      const domain = linkDomain(link);
      if (domain) increment(domains, domain);
    }
  }

  const authors = Array.from(authorCounts.entries())
    .sort((a, b) => b[1].engagement - a[1].engagement || b[1].count - a[1].count)
    .map(([handle, row]) => ({ handle, name: row.name, count: row.count, engagement: row.engagement }));

  return {
    listId: digest.listId,
    fetchedAt: digest.fetchedAt,
    totalTweets: digest.tweets.length,
    listTweets: digest.tweets.filter((tweet) => tweet.timelineKind === 'list-tweet').length,
    conversationContext: digest.tweets.filter((tweet) => tweet.timelineKind === 'conversation-context').length,
    linkTypes: compactRows(linkTypes, 'type'),
    domains: compactRows(domains, 'domain'),
    authors,
    topTweets: [...digest.tweets].sort((a, b) => engagement(b) - engagement(a)).slice(0, 10),
  };
}

export function deriveTodaySources(digest: StoredXListDigest): TodaySourceRow[] {
  const byUrl = new Map<string, TodaySourceRow>();
  for (const tweet of digest.tweets) {
    for (const url of tweet.links ?? []) {
      const previous = byUrl.get(url) ?? {
        url,
        domain: linkDomain(url),
        type: linkType(url),
        count: 0,
        authors: [],
        tweetIds: [],
        firstSeenAt: tweet.postedAt,
        lastSeenAt: tweet.postedAt,
      };
      previous.count += 1;
      if (tweet.author && !previous.authors.includes(tweet.author)) previous.authors.push(tweet.author);
      if (tweet.id && !previous.tweetIds.includes(tweet.id)) previous.tweetIds.push(tweet.id);
      if (tweet.postedAt && (!previous.firstSeenAt || tweet.postedAt < previous.firstSeenAt)) previous.firstSeenAt = tweet.postedAt;
      if (tweet.postedAt && (!previous.lastSeenAt || tweet.postedAt > previous.lastSeenAt)) previous.lastSeenAt = tweet.postedAt;
      byUrl.set(url, previous);
    }
  }
  return Array.from(byUrl.values()).sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));
}

export function buildTodayContextPack(digest: StoredXListDigest): string {
  const analysis = deriveTodayAnalysis(digest);
  const sources = deriveTodaySources(digest).slice(0, 20);
  return [
    `# X List ${digest.listId} Today Context`,
    `Fetched: ${digest.fetchedAt}`,
    `Tweets: ${analysis.totalTweets} (${analysis.listTweets} list tweets, ${analysis.conversationContext} context)`,
    '',
    '## Top tweets',
    ...analysis.topTweets.slice(0, 10).map((tweet, index) => `${index + 1}. @${tweet.author ?? 'unknown'}: ${tweet.text ?? ''}\n   ${tweet.url ?? ''}`),
    '',
    '## Sources',
    ...sources.map((source, index) => `${index + 1}. [${source.type}] ${source.domain} — ${source.url} (${source.count} tweet${source.count === 1 ? '' : 's'})`),
  ].join('\n');
}
```

- [ ] **Step 4: Run focused tests and build**

```bash
npm test -- tests/x-list-store.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 5: Commit**

```bash
git add src/x-list-store.ts tests/x-list-store.test.ts
git commit -m "feat: add X list digest store helpers"
```

---

### Task 2: Ensure `ft x-list` writes stable latest JSON

**Files:**
- Modify: `src/cli.ts`
- Test: existing x-list tests if present; otherwise build/help smoke.

- [ ] **Step 1: Inspect current `x-list` write behavior**

Confirm whether the default command writes both:

- `<listId>-<stamp>.json`
- `<listId>-latest.json`

If it already writes `<listId>-latest.json`, skip to Step 4.

- [ ] **Step 2: Add stable latest JSON write if missing**

In the `x-list` command near the existing latest HTML write, add:

```ts
const digestForJson = { ...digest, rawPages: undefined };
fs.writeFileSync(path.join(storeDir, `${digest.listId}-latest.json`), JSON.stringify(digestForJson, null, 2), { mode: 0o600 });
```

If the command already constructs a JSON-safe digest object, reuse that existing object instead of adding a second shape.

- [ ] **Step 3: Run build and command smoke**

```bash
npm run build
node dist/cli.js x-list --help
```

Expected: build passes and help still lists existing x-list flags.

- [ ] **Step 4: Commit only if code changed**

```bash
git add src/cli.ts
git commit -m "feat: write stable latest X list digest JSON"
```

---

### Task 3: Add list-backed Today API routes

**Files:**
- Modify: `src/web/server.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Add web API tests**

Append to `tests/web-server.test.ts`:

```ts
test('web API serves list-backed today digest surfaces', async () => {
  await withTempFieldTheoryData(async () => {
    const xListDir = path.join(process.env.FT_DATA_DIR!, '..', 'x-lists');
    await mkdir(xListDir, { recursive: true });
    await writeFile(path.join(xListDir, '197-latest.json'), JSON.stringify({
      listId: '197',
      fetchedAt: '2026-06-24T12:00:00.000Z',
      tweets: [{
        id: '1',
        timelineKind: 'list-tweet',
        url: 'https://x.com/alice/status/1',
        author: 'alice',
        authorName: 'Alice',
        postedAt: '2026-06-24T10:00:00.000Z',
        text: 'Agents paper https://arxiv.org/abs/1234.5678',
        links: ['https://arxiv.org/abs/1234.5678'],
        engagement: { likeCount: 10, repostCount: 4, replyCount: 2, quoteCount: 1, viewCount: 1000 },
      }],
      stats: { count: 1, fetchedCount: 1, timeFilteredCount: 0, quotedOriginalsDropped: 0, pagesFetched: 1, stopReason: 'no-cursor', sinceHours: 24 },
    }));

    const server = await startTestServer();
    try {
      const today = await fetch(`${server.baseUrl}/api/lists/197/today`);
      assert.equal(today.status, 200);
      assert.equal(((await today.json()) as { tweets: unknown[] }).tweets.length, 1);

      const analysis = await fetch(`${server.baseUrl}/api/lists/197/analysis`);
      assert.equal(analysis.status, 200);
      assert.equal(((await analysis.json()) as { totalTweets: number }).totalTweets, 1);

      const sources = await fetch(`${server.baseUrl}/api/lists/197/sources`);
      assert.equal(sources.status, 200);
      assert.equal(((await sources.json()) as { sources: unknown[] }).sources.length, 1);

      const context = await fetch(`${server.baseUrl}/api/lists/197/context`);
      assert.equal(context.status, 200);
      assert.match(await context.text(), /X List 197 Today Context/);
    } finally {
      await server.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify route failure**

```bash
npm test -- tests/web-server.test.ts
```

Expected: new routes return 404.

- [ ] **Step 3: Add route imports**

In `src/web/server.ts`, import:

```ts
import {
  buildTodayContextPack,
  deriveTodayAnalysis,
  deriveTodaySources,
  readLatestXListDigest,
} from '../x-list-store.js';
```

- [ ] **Step 4: Add route helper**

Inside `src/web/server.ts`:

```ts
async function readRequiredListDigest(listId: string) {
  const digest = await readLatestXListDigest(listId);
  if (!digest) throw new HttpError(404, 'X list digest not found. Run ft x-list first.');
  return digest;
}
```

- [ ] **Step 5: Add API routes inside `handleApi()`**

Add before the final `throw new HttpError(404, 'Not found')`:

```ts
const listTodayMatch = pathname.match(/^\/api\/lists\/([^/]+)\/today$/);
if (listTodayMatch) {
  sendJson(res, 200, await readRequiredListDigest(listTodayMatch[1]));
  return;
}

const listAnalysisMatch = pathname.match(/^\/api\/lists\/([^/]+)\/analysis$/);
if (listAnalysisMatch) {
  const digest = await readRequiredListDigest(listAnalysisMatch[1]);
  sendJson(res, 200, deriveTodayAnalysis(digest));
  return;
}

const listSourcesMatch = pathname.match(/^\/api\/lists\/([^/]+)\/sources$/);
if (listSourcesMatch) {
  const digest = await readRequiredListDigest(listSourcesMatch[1]);
  sendJson(res, 200, { sources: deriveTodaySources(digest) });
  return;
}

const listContextMatch = pathname.match(/^\/api\/lists\/([^/]+)\/context$/);
if (listContextMatch) {
  const digest = await readRequiredListDigest(listContextMatch[1]);
  sendText(res, 200, buildTodayContextPack(digest), 'text/markdown; charset=utf-8');
  return;
}
```

- [ ] **Step 6: Run tests and build**

```bash
npm test -- tests/web-server.test.ts tests/x-list-store.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 7: Commit**

```bash
git add src/web/server.ts tests/web-server.test.ts
git commit -m "feat: serve X list today APIs"
```

---

### Task 4: Add web lanes for Home, Today, Analyze, Map, Sources, Discuss

**Files:**
- Modify: `src/web/app-shell.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Extend app shell smoke test**

Update the app shell test to assert the lane names exist:

```ts
for (const lane of ['home', 'today', 'analyze', 'map', 'sources', 'discuss']) {
  assert.match(html, new RegExp(`data-lane="${lane}"`));
}
assert.match(appJs, /renderTodayLane/);
assert.match(appJs, /renderSourcesLane/);
assert.match(appJs, /renderDiscussLane/);
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/web-server.test.ts
```

Expected: app shell test fails because lanes are missing.

- [ ] **Step 3: Add lane navigation to `renderAppShell()`**

Replace or extend the current sidebar navigation with:

```html
<nav class="lanes" aria-label="Field Theory sections">
  <button class="lane active" type="button" data-lane="home">Home</button>
  <button class="lane" type="button" data-lane="today">Today</button>
  <button class="lane" type="button" data-lane="analyze">Analyze</button>
  <button class="lane" type="button" data-lane="map">Map</button>
  <button class="lane" type="button" data-lane="sources">Sources</button>
  <button class="lane" type="button" data-lane="discuss">Discuss</button>
  <button class="lane" type="button" data-lane="bookmarks">Bookmarks</button>
</nav>
```

- [ ] **Step 4: Add list ID configuration control**

Add near the search form:

```html
<label class="list-config">
  <span>X List ID</span>
  <input id="listId" name="listId" value="1979812953135497678" inputmode="numeric">
</label>
```

If the repo has a preferred default list in docs or config, use that value. Otherwise use the prototype reference list from `docs/x-list-digest-prototype.md`.

- [ ] **Step 5: Add lane CSS**

Append to `appCss`:

```css
.lanes { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:0 0 18px; }
.lane { border:1px solid var(--line); background:#0b1220; color:var(--muted); border-radius:14px; padding:10px; cursor:pointer; }
.lane.active { border-color:var(--accent); color:var(--accent); background:#10243a; }
.list-config { display:grid; gap:6px; margin-bottom:14px; color:var(--muted); font-size:12px; }
.list-config input { border:1px solid var(--line); background:#0b1220; color:var(--text); border-radius:12px; padding:10px; }
.source-table { width:100%; border-collapse:collapse; overflow:hidden; border-radius:16px; }
.source-table th,.source-table td { border-bottom:1px solid var(--line); padding:10px; text-align:left; vertical-align:top; }
.bar-row { display:grid; grid-template-columns:160px 1fr 48px; gap:10px; align-items:center; margin:8px 0; }
.bar { height:10px; border-radius:999px; background:var(--accent); }
.context-box { width:100%; min-height:360px; border:1px solid var(--line); background:#0b1220; color:var(--text); border-radius:16px; padding:14px; font:13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
```

- [ ] **Step 6: Add browser JS lane renderers**

In `appJs`, add helpers:

```js
function currentListId() {
  return document.querySelector('#listId')?.value.trim() || '1979812953135497678';
}

async function fetchListJson(path) {
  return fetchJson('/api/lists/' + encodeURIComponent(currentListId()) + path);
}

async function renderHomeLane() {
  const [digest, analysis] = await Promise.all([fetchListJson('/today'), fetchListJson('/analysis')]);
  results.replaceChildren();
  const card = el('article', 'bookmark-card');
  card.append(
    el('h2', '', 'Today from list ' + digest.listId),
    el('p', 'bookmark-text', 'Fetched ' + digest.fetchedAt + ' · ' + digest.tweets.length + ' tweets · ' + digest.stats.pagesFetched + ' page(s)'),
  );
  for (const tweet of analysis.topTweets.slice(0, 5)) card.append(renderCard(tweet));
  results.append(card);
  setStatus('Home loaded from X List ' + digest.listId);
}

async function renderTodayLane() {
  const digest = await fetchListJson('/today');
  results.replaceChildren();
  for (const tweet of digest.tweets) results.append(renderCard(tweet));
  setStatus('Showing ' + digest.tweets.length + ' list tweets');
}

function renderBars(title, rows, key) {
  const section = el('article', 'bookmark-card');
  section.append(el('h2', '', title));
  const max = Math.max(1, ...rows.map((row) => row.count));
  for (const row of rows.slice(0, 12)) {
    const line = el('div', 'bar-row');
    line.append(el('span', '', row[key]));
    const bar = el('div', 'bar');
    bar.style.width = Math.max(4, Math.round((row.count / max) * 100)) + '%';
    line.append(bar, el('strong', '', String(row.count)));
    section.append(line);
  }
  return section;
}

async function renderAnalyzeLane() {
  const analysis = await fetchListJson('/analysis');
  results.replaceChildren(
    renderBars('Link types', analysis.linkTypes, 'type'),
    renderBars('Domains', analysis.domains, 'domain'),
    renderBars('Authors', analysis.authors, 'handle'),
  );
  setStatus('Analysis loaded');
}

async function renderMapLane() {
  const sources = (await fetchListJson('/sources')).sources;
  results.replaceChildren();
  const card = el('article', 'bookmark-card');
  card.append(el('h2', '', 'Source map'));
  for (const source of sources.slice(0, 30)) {
    card.append(el('p', 'bookmark-text', source.authors.join(', ') + ' → ' + source.domain + ' (' + source.type + ')'));
  }
  results.append(card);
  setStatus('Map loaded');
}

async function renderSourcesLane() {
  const sources = (await fetchListJson('/sources')).sources;
  const table = el('table', 'source-table');
  const head = document.createElement('thead');
  head.innerHTML = '<tr><th>Type</th><th>Domain</th><th>URL</th><th>Authors</th><th>Tweets</th></tr>';
  const body = document.createElement('tbody');
  for (const source of sources) {
    const row = document.createElement('tr');
    for (const value of [source.type, source.domain, source.url, source.authors.join(', '), String(source.count)]) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    body.append(row);
  }
  table.append(head, body);
  results.replaceChildren(table);
  setStatus('Showing ' + sources.length + ' sources');
}

async function renderDiscussLane() {
  const response = await fetch('/api/lists/' + encodeURIComponent(currentListId()) + '/context');
  if (!response.ok) throw new Error(await response.text());
  const text = await response.text();
  const textarea = el('textarea', 'context-box');
  textarea.value = text;
  const copy = el('button', 'details-btn', 'Copy context');
  copy.addEventListener('click', () => navigator.clipboard.writeText(text));
  const card = el('article', 'bookmark-card');
  card.append(el('h2', '', 'Discuss context'), el('p', 'bookmark-text', 'Copy this into your preferred LLM/chat surface.'), copy, textarea);
  results.replaceChildren(card);
  setStatus('Discussion context ready');
}
```

- [ ] **Step 7: Add lane dispatcher**

Add:

```js
async function renderLane(lane) {
  try {
    setStatus('Loading ' + lane + '…');
    if (lane === 'home') return renderHomeLane();
    if (lane === 'today') return renderTodayLane();
    if (lane === 'analyze') return renderAnalyzeLane();
    if (lane === 'map') return renderMapLane();
    if (lane === 'sources') return renderSourcesLane();
    if (lane === 'discuss') return renderDiscussLane();
    return fetchBookmarks(true);
  } catch (error) {
    results.replaceChildren();
    setStatus(error.message || 'Failed to load ' + lane);
  }
}

for (const button of document.querySelectorAll('[data-lane]')) {
  button.addEventListener('click', () => {
    for (const other of document.querySelectorAll('[data-lane]')) other.classList.toggle('active', other === button);
    renderLane(button.dataset.lane);
  });
}
```

Start the app on `home` rather than immediately calling `fetchBookmarks(true)`.

- [ ] **Step 8: Run tests and build**

```bash
npm test -- tests/web-server.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 9: Commit**

```bash
git add src/web/app-shell.ts tests/web-server.test.ts
git commit -m "feat: add list today web lanes"
```

---

### Task 5: Manual verification

**Files:**
- Modify only if verification reveals issues.

- [ ] **Step 1: Generate or refresh the list digest**

```bash
npm run build
node dist/cli.js x-list 1979812953135497678 --since-hours 24 --max-pages 2
```

Expected: latest HTML and JSON files exist under `~/.fieldtheory/x-lists/`.

- [ ] **Step 2: Start web server**

```bash
node dist/cli.js serve --port 3000
```

- [ ] **Step 3: Verify APIs**

```bash
curl -s http://127.0.0.1:3000/api/lists/1979812953135497678/today | head -c 300
curl -s http://127.0.0.1:3000/api/lists/1979812953135497678/analysis | head -c 300
curl -s http://127.0.0.1:3000/api/lists/1979812953135497678/sources | head -c 300
curl -s http://127.0.0.1:3000/api/lists/1979812953135497678/context | head -c 300
```

Expected: all return meaningful content; missing list IDs return 404 with “Run ft x-list first.”

- [ ] **Step 4: Verify browser lanes**

Open `http://127.0.0.1:3000` and verify:

- Home shows list summary and top tweets.
- Today shows the list digest cards.
- Analyze shows link type/domain/author bars.
- Map shows author → domain relationships.
- Sources shows extracted link rows.
- Discuss shows copyable context text.
- Bookmarks still works as before.

- [ ] **Step 5: Run final tests**

```bash
npm run build
npm test
```

Expected: build and tests pass.

---

## Acceptance Criteria

1. The previous home-feed Today plan remains untouched.
2. The new web Today path uses `fetchXListDigest()`/stored X List digest data, not HomeTimeline.
3. Existing bookmark browser behavior remains available.
4. `Home`, `Today`, `Analyze`, `Map`, `Sources`, and `Discuss` lanes exist in the web UI.
5. The API exposes list-backed digest, analysis, sources, and context routes.
6. `npm run build` and `npm test` pass.

## Deferred Work

- Browser-triggered `ft x-list` sync with job progress and a per-process token.
- Persist multiple named lists and switch between them from configuration.
- Promote list-linked sources into canonical bookmarks.
- LLM-generated daily briefs and discussion chat with citations.
- Canvas-based graph map once source/author volume justifies it.
