# Today GraphQL Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `Today` feed to Field Theory that fetches the logged-in user’s X home/latest timeline through the same browser-cookie GraphQL architecture as bookmarks, caches it locally, and exposes it in the existing web interface.

**Architecture:** First extract the duplicated X GraphQL session/header/retry machinery from bookmarks/following into a shared `src/x-graphql.ts`. Then add a separate `src/today/` feature folder with fetch, sync/cache, paths, and read helpers. Finally add API routes and a Today tab to the existing dependency-free web UI without changing bookmark storage.

**Tech Stack:** TypeScript NodeNext, Node built-in `fetch`/`http`, existing browser cookie extraction, existing `convertTweetToRecord()` parser, JSONL cache, existing web server/app-shell.

---

## Scope and assumptions

- “Today” means a read-only X timeline lane, not local bookmarks filtered by date.
- The first version stores Today items in `~/.fieldtheory/bookmarks/today/today.jsonl` and `meta.json`.
- Today records reuse `BookmarkRecord` because `convertTweetToRecord()` already handles tweet text, authors, links, media, engagement, note tweets, and quotes.
- The first version does not merge Today into `bookmarks.db` or the canonical bookmark index.
- The X web GraphQL query ID is volatile. The implementation must support `--query-id` and `FT_TODAY_QUERY_ID`; a checked-in default is allowed only if verified during implementation.
- The first version performs only authenticated GET requests to X GraphQL. It never writes to X.

## File Structure

- Create `src/x-graphql.ts`: shared X public bearer, Chrome UA, session resolution, GraphQL URL/header builder, retrying JSON fetch, rate-limit error.
- Modify `src/graphql-bookmarks.ts`: replace private auth/header/retry helpers with `src/x-graphql.ts` where practical, keeping public behavior stable.
- Modify `src/following/fetch.ts`: replace duplicated session/header code with `src/x-graphql.ts`, keeping `resolveBrowserSession` as a compatibility re-export if existing callers need it.
- Create `src/today/types.ts`: Today sync/read types.
- Create `src/today/paths.ts`: Today cache/meta paths under `dataDir()/today`.
- Create `src/today/fetch.ts`: GraphQL Today URL construction, response parsing, page fetch loop.
- Create `src/today/sync.ts`: merge JSONL cache, write meta, progress result.
- Create `src/today/db.ts`: lightweight cache read/list/get/stats helpers for API and CLI.
- Modify `src/web/server.ts`: add `/api/today`, `/api/today/:id`, `/api/today/stats`, `POST /api/today/sync` only if a per-process token exists; otherwise keep sync CLI-only for this phase.
- Modify `src/web/app-shell.ts`: add Bookmarks/Today lane switching and a Sync Today button only if the API endpoint is implemented.
- Modify `src/cli.ts`: add `ft sync-today` and optional `ft today list --json`/`ft today show <id> --json` if small.
- Add `tests/x-graphql.test.ts`, `tests/today.test.ts`, and extend `tests/web-server.test.ts`.

---

### Task 1: Extract shared X GraphQL auth and retry helpers

**Files:**
- Create: `src/x-graphql.ts`
- Modify: `src/following/fetch.ts`
- Test: `tests/x-graphql.test.ts`

- [ ] **Step 1: Write failing tests for shared helpers**

Create `tests/x-graphql.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildXGraphqlHeaders,
  buildXGraphqlGetUrl,
  parseXRateLimitRetryAfterSec,
  XRateLimitError,
  fetchXGraphqlJson,
} from '../src/x-graphql.js';

test('buildXGraphqlHeaders includes bearer, csrf, active user, language, and cookie', () => {
  const headers = buildXGraphqlHeaders({ csrfToken: 'csrf', cookieHeader: 'ct0=csrf; auth_token=abc' });
  assert.match(headers.authorization, /^Bearer /);
  assert.equal(headers['x-csrf-token'], 'csrf');
  assert.equal(headers['x-twitter-auth-type'], 'OAuth2Session');
  assert.equal(headers['x-twitter-active-user'], 'yes');
  assert.equal(headers['x-twitter-client-language'], 'en');
  assert.equal(headers.cookie, 'ct0=csrf; auth_token=abc');
});

test('buildXGraphqlGetUrl serializes variables and features', () => {
  const url = buildXGraphqlGetUrl({
    queryId: 'qid',
    operationName: 'HomeTimeline',
    variables: { count: 20, cursor: 'c1' },
    features: { longform_notetweets_consumption_enabled: true },
  });
  assert.equal(url.origin, 'https://x.com');
  assert.equal(url.pathname, '/i/api/graphql/qid/HomeTimeline');
  assert.deepEqual(JSON.parse(url.searchParams.get('variables') ?? '{}'), { count: 20, cursor: 'c1' });
  assert.deepEqual(JSON.parse(url.searchParams.get('features') ?? '{}'), { longform_notetweets_consumption_enabled: true });
});

test('parseXRateLimitRetryAfterSec reads retry-after seconds and reset epoch', () => {
  const retry = new Response('', { status: 429, headers: { 'retry-after': '12' } });
  assert.equal(parseXRateLimitRetryAfterSec(retry, () => 1_000), 12);

  const reset = new Response('', { status: 429, headers: { 'x-rate-limit-reset': '20' } });
  assert.equal(parseXRateLimitRetryAfterSec(reset, () => 10_000), 10);
});

test('fetchXGraphqlJson retries 429 then returns JSON', async () => {
  let calls = 0;
  const result = await fetchXGraphqlJson({
    url: new URL('https://x.com/i/api/graphql/qid/HomeTimeline'),
    headers: { cookie: 'ct0=csrf' },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return new Response('rate limited', { status: 429, headers: { 'retry-after': '1' } });
      return Response.json({ ok: true });
    },
    sleep: async () => undefined,
    maxAttempts: 2,
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
});

test('fetchXGraphqlJson throws XRateLimitError after exhausting 429 retries', async () => {
  await assert.rejects(
    fetchXGraphqlJson({
      url: new URL('https://x.com/i/api/graphql/qid/HomeTimeline'),
      headers: { cookie: 'ct0=csrf' },
      fetchImpl: async () => new Response('rate limited', { status: 429, headers: { 'retry-after': '7' } }),
      sleep: async () => undefined,
      maxAttempts: 1,
    }),
    (error) => error instanceof XRateLimitError && error.retryAfterSec === 7,
  );
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test -- tests/x-graphql.test.ts
```

Expected: fail because `src/x-graphql.ts` does not exist.

- [ ] **Step 3: Implement `src/x-graphql.ts`**

```ts
import { loadChromeSessionConfig } from './config.js';
import { extractChromeXCookies } from './chrome-cookies.js';
import { extractFirefoxXCookies } from './firefox-cookies.js';

export const X_PUBLIC_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export const X_CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

export interface XBrowserSessionOptions {
  browser?: string;
  chromeUserDataDir?: string;
  chromeProfileDirectory?: string;
  firefoxProfileDir?: string;
  csrfToken?: string;
  cookieHeader?: string;
}

export interface XBrowserSession {
  csrfToken: string;
  cookieHeader: string;
}

export function resolveXBrowserSession(options: XBrowserSessionOptions = {}): XBrowserSession {
  if (options.csrfToken) {
    return { csrfToken: options.csrfToken, cookieHeader: options.cookieHeader ?? `ct0=${options.csrfToken}` };
  }
  const config = loadChromeSessionConfig({ browserId: options.browser });
  if (config.browser.cookieBackend === 'firefox') return extractFirefoxXCookies(options.firefoxProfileDir);
  const chromeDir = options.chromeUserDataDir ?? config.chromeUserDataDir;
  const chromeProfile = options.chromeProfileDirectory ?? config.chromeProfileDirectory;
  return extractChromeXCookies(chromeDir, chromeProfile, config.browser);
}

export function buildXGraphqlHeaders(session: XBrowserSession): Record<string, string> {
  return {
    authorization: `Bearer ${X_PUBLIC_BEARER}`,
    'x-csrf-token': session.csrfToken,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'content-type': 'application/json',
    'user-agent': X_CHROME_UA,
    cookie: session.cookieHeader,
  };
}

export function buildXGraphqlGetUrl(input: {
  queryId: string;
  operationName: string;
  variables: Record<string, unknown>;
  features: Record<string, unknown>;
}): URL {
  const params = new URLSearchParams({
    variables: JSON.stringify(input.variables),
    features: JSON.stringify(input.features),
  });
  return new URL(`https://x.com/i/api/graphql/${input.queryId}/${input.operationName}?${params}`);
}

export class XRateLimitError extends Error {
  constructor(message: string, readonly retryAfterSec?: number) {
    super(message);
    this.name = 'XRateLimitError';
  }
}

export function parseXRateLimitRetryAfterSec(response: Response, nowMs: () => number = () => Date.now()): number | undefined {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
    const resumeAt = Date.parse(retryAfter);
    if (!Number.isNaN(resumeAt)) {
      const secondsUntil = Math.ceil((resumeAt - nowMs()) / 1000);
      if (secondsUntil > 0) return secondsUntil;
    }
  }
  const resetAt = Number(response.headers.get('x-rate-limit-reset'));
  if (Number.isFinite(resetAt) && resetAt > 0) {
    const secondsUntil = Math.ceil(resetAt - nowMs() / 1000);
    if (secondsUntil > 0) return secondsUntil;
  }
  return undefined;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchXGraphqlJson(input: {
  url: URL;
  headers: Record<string, string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
}): Promise<unknown> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sleep = input.sleep ?? defaultSleep;
  const maxAttempts = input.maxAttempts ?? 4;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetchImpl(input.url, { headers: input.headers });
    if (response.status === 429) {
      const retryAfterSec = parseXRateLimitRetryAfterSec(response);
      lastError = new XRateLimitError(`Rate limited (429) on attempt ${attempt + 1}`, retryAfterSec);
      if (attempt + 1 < maxAttempts) await sleep((retryAfterSec ?? Math.min(15 * Math.pow(2, attempt), 120)) * 1000);
      continue;
    }
    if (response.status >= 500) {
      lastError = new Error(`Server error (${response.status}) on attempt ${attempt + 1}`);
      if (attempt + 1 < maxAttempts) await sleep(5000 * (attempt + 1));
      continue;
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`X GraphQL API returned ${response.status}.\nResponse: ${text.slice(0, 300)}`);
    }
    return response.json();
  }

  throw lastError ?? new Error('X GraphQL API: all retry attempts failed.');
}
```

- [ ] **Step 4: Replace following session/header internals with shared helpers**

In `src/following/fetch.ts`:

```ts
import {
  buildXGraphqlGetUrl,
  buildXGraphqlHeaders,
  fetchXGraphqlJson,
  resolveXBrowserSession,
  type XBrowserSessionOptions,
} from '../x-graphql.js';
```

Keep the existing exported `BrowserSessionOptions` and `resolveBrowserSession()` as compatibility wrappers:

```ts
export type BrowserSessionOptions = XBrowserSessionOptions;

export function resolveBrowserSession(options: BrowserSessionOptions): { csrfToken: string; cookieHeader: string } {
  return resolveXBrowserSession(options);
}
```

Update `buildFollowingUrl()` to return `buildXGraphqlGetUrl({ ... }).toString()` or a `URL`, and update `fetchFollowing()` to use `buildXGraphqlHeaders(session)` and `fetchXGraphqlJson()`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- tests/x-graphql.test.ts tests/following.test.ts
npm run build
```

Expected: tests and build pass; no behavior change for following.

- [ ] **Step 6: Commit**

```bash
git add src/x-graphql.ts src/following/fetch.ts tests/x-graphql.test.ts
git commit -m "refactor: share X GraphQL session helpers"
```

---

### Task 2: Add Today types and paths

**Files:**
- Create: `src/today/types.ts`
- Create: `src/today/paths.ts`
- Test: `tests/today.test.ts`

- [ ] **Step 1: Write failing path/type smoke tests**

Create `tests/today.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { todayCachePath, todayDir, todayMetaPath } from '../src/today/paths.js';

test('today paths live under FT_DATA_DIR/today', () => {
  const previous = process.env.FT_DATA_DIR;
  const root = path.join(os.tmpdir(), 'ft-today-paths');
  process.env.FT_DATA_DIR = root;
  try {
    assert.equal(todayDir(), path.join(root, 'today'));
    assert.equal(todayCachePath(), path.join(root, 'today', 'today.jsonl'));
    assert.equal(todayMetaPath(), path.join(root, 'today', 'meta.json'));
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
  }
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/today.test.ts
```

Expected: fail because `src/today/paths.ts` does not exist.

- [ ] **Step 3: Implement Today path helpers**

Create `src/today/paths.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../paths.js';

function ensureDirSync(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function todayDir(): string {
  return path.join(dataDir(), 'today');
}

export function ensureTodayDir(): string {
  const dir = todayDir();
  ensureDirSync(dir);
  return dir;
}

export function todayCachePath(): string {
  return path.join(todayDir(), 'today.jsonl');
}

export function todayMetaPath(): string {
  return path.join(todayDir(), 'meta.json');
}
```

Create `src/today/types.ts`:

```ts
import type { BookmarkRecord } from '../types.js';
import type { XBrowserSessionOptions } from '../x-graphql.js';

export type TodayRecord = BookmarkRecord & {
  timelineKind: 'today';
  seenAt: string;
};

export interface TodayMeta {
  lastUpdated?: string;
  cursor?: string;
  count: number;
  queryId?: string;
  operationName: string;
}

export interface TodayFetchOptions extends XBrowserSessionOptions {
  queryId?: string;
  operationName?: string;
  count?: number;
  cursor?: string;
  maxPages?: number;
  delayMs?: number;
  deadline?: number;
  fetchImpl?: typeof fetch;
  now?: () => string;
}

export interface TodayPageResult {
  records: TodayRecord[];
  nextCursor?: string;
}

export interface TodayFetchResult {
  records: TodayRecord[];
  pages: number;
  stopReason: string;
  nextCursor?: string;
}

export interface TodaySyncOptions extends TodayFetchOptions {
  rebuild?: boolean;
  maxMinutes?: number;
  onProgress?: (progress: TodaySyncProgress) => void;
}

export interface TodaySyncProgress {
  page: number;
  totalFetched: number;
  newAdded: number;
  running: boolean;
  done: boolean;
  stopReason?: string;
}

export interface TodaySyncResult {
  added: number;
  totalToday: number;
  pages: number;
  stopReason: string;
  cachePath: string;
  metaPath: string;
}
```

- [ ] **Step 4: Run tests and build**

```bash
npm test -- tests/today.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 5: Commit**

```bash
git add src/today/paths.ts src/today/types.ts tests/today.test.ts
git commit -m "feat: add today feed paths and types"
```

---

### Task 3: Add Today GraphQL fetch parser

**Files:**
- Create: `src/today/fetch.ts`
- Modify: `tests/today.test.ts`

- [ ] **Step 1: Add parser and URL tests**

Append to `tests/today.test.ts`:

```ts
import { buildTodayTimelineUrl, parseTodayTimelineResponse, fetchToday } from '../src/today/fetch.js';

const NOW = '2026-06-24T12:00:00.000Z';

function tweetResult(id = '200') {
  return {
    rest_id: id,
    core: { user_results: { result: { rest_id: 'u1', core: { screen_name: 'alice', name: 'Alice' }, legacy: { screen_name: 'alice', name: 'Alice' } } } },
    legacy: {
      id_str: id,
      full_text: 'Today feed item',
      created_at: 'Wed Jun 24 10:00:00 +0000 2026',
      favorite_count: 2,
      retweet_count: 1,
      reply_count: 0,
      quote_count: 0,
      bookmark_count: 1,
      entities: { urls: [] },
    },
  };
}

test('buildTodayTimelineUrl uses configurable query id and operation', () => {
  const url = buildTodayTimelineUrl({ queryId: 'qid', operationName: 'HomeTimeline', count: 20, cursor: 'cursor' });
  assert.equal(url.pathname, '/i/api/graphql/qid/HomeTimeline');
  const variables = JSON.parse(url.searchParams.get('variables') ?? '{}');
  assert.equal(variables.count, 20);
  assert.equal(variables.cursor, 'cursor');
  assert.equal(variables.includePromotedContent, false);
});

test('parseTodayTimelineResponse extracts tweet records and bottom cursor', () => {
  const response = {
    data: { home: { home_timeline_urt: { instructions: [{
      type: 'TimelineAddEntries',
      entries: [
        { entryId: 'tweet-200', sortIndex: '1', content: { itemContent: { tweet_results: { result: tweetResult('200') } } } },
        { entryId: 'cursor-bottom-1', content: { value: 'next' } },
      ],
    }] } } },
  };
  const result = parseTodayTimelineResponse(response, NOW);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0]?.id, '200');
  assert.equal(result.records[0]?.timelineKind, 'today');
  assert.equal(result.records[0]?.seenAt, NOW);
  assert.equal(result.nextCursor, 'next');
});

test('fetchToday pages until maxPages using shared GraphQL transport', async () => {
  const result = await fetchToday({
    queryId: 'qid',
    csrfToken: 'csrf',
    cookieHeader: 'ct0=csrf',
    maxPages: 1,
    delayMs: 0,
    now: () => NOW,
    fetchImpl: async () => Response.json({
      data: { home: { home_timeline_urt: { instructions: [{
        type: 'TimelineAddEntries',
        entries: [{ entryId: 'tweet-201', content: { itemContent: { tweet_results: { result: tweetResult('201') } } } }],
      }] } } },
    }),
  });
  assert.equal(result.records.length, 1);
  assert.equal(result.pages, 1);
  assert.equal(result.stopReason, 'max pages reached');
});
```

- [ ] **Step 2: Run tests to verify failure**

```bash
npm test -- tests/today.test.ts
```

Expected: fail because `src/today/fetch.ts` does not exist.

- [ ] **Step 3: Implement `src/today/fetch.ts`**

```ts
import { convertTweetToRecord } from '../graphql-bookmarks.js';
import { buildXGraphqlGetUrl, buildXGraphqlHeaders, fetchXGraphqlJson, resolveXBrowserSession } from '../x-graphql.js';
import type { TodayFetchOptions, TodayFetchResult, TodayPageResult, TodayRecord } from './types.js';

export const DEFAULT_TODAY_OPERATION = 'HomeTimeline';

const TODAY_FEATURES: Record<string, boolean> = {
  articles_preview_enabled: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  graphql_timeline_v2_bookmark_timeline: true,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  verified_phone_label_enabled: false,
};

export function resolveTodayQueryId(input?: string): string {
  const queryId = input ?? process.env.FT_TODAY_QUERY_ID;
  if (!queryId) {
    throw new Error('Missing Today GraphQL query id. Pass --query-id or set FT_TODAY_QUERY_ID.');
  }
  return queryId;
}

export function buildTodayTimelineUrl(input: {
  queryId: string;
  operationName?: string;
  count: number;
  cursor?: string;
}): URL {
  const variables: Record<string, unknown> = {
    count: input.count,
    includePromotedContent: false,
    latestControlAvailable: true,
    requestContext: 'launch',
  };
  if (input.cursor) variables.cursor = input.cursor;
  return buildXGraphqlGetUrl({
    queryId: input.queryId,
    operationName: input.operationName ?? DEFAULT_TODAY_OPERATION,
    variables,
    features: TODAY_FEATURES,
  });
}

function collectTimelineEntries(json: unknown): unknown[] {
  const root = json as { data?: any };
  const instructions =
    root.data?.home?.home_timeline_urt?.instructions ??
    root.data?.home?.home_timeline?.timeline?.instructions ??
    root.data?.home_timeline_urt?.instructions ??
    [];
  const entries: unknown[] = [];
  for (const inst of instructions) {
    if (inst?.type === 'TimelineAddEntries' && Array.isArray(inst.entries)) entries.push(...inst.entries);
  }
  return entries;
}

function tweetResultFromEntry(entry: any): unknown {
  return entry?.content?.itemContent?.tweet_results?.result;
}

export function parseTodayTimelineResponse(json: unknown, now = new Date().toISOString()): TodayPageResult {
  const records: TodayRecord[] = [];
  let nextCursor: string | undefined;

  for (const entry of collectTimelineEntries(json)) {
    const candidate = entry as any;
    if (typeof candidate.entryId === 'string' && candidate.entryId.startsWith('cursor-bottom')) {
      nextCursor = candidate.content?.value;
      continue;
    }
    const tweetResult = tweetResultFromEntry(candidate);
    if (!tweetResult) continue;
    const record = convertTweetToRecord(tweetResult, now);
    if (record) records.push({ ...record, timelineKind: 'today', seenAt: now });
  }

  return { records, nextCursor };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchToday(options: TodayFetchOptions = {}): Promise<TodayFetchResult> {
  const queryId = resolveTodayQueryId(options.queryId);
  const operationName = options.operationName ?? DEFAULT_TODAY_OPERATION;
  const count = Math.max(1, Math.min(options.count ?? 40, 100));
  const maxPages = options.maxPages ?? 1;
  const delayMs = options.delayMs ?? 600;
  const nowFn = options.now ?? (() => new Date().toISOString());
  const session = resolveXBrowserSession(options);
  const headers = buildXGraphqlHeaders(session);

  const records: TodayRecord[] = [];
  let cursor = options.cursor;
  let pages = 0;
  let stopReason = 'max pages reached';

  while (pages < maxPages) {
    if (options.deadline && Date.now() > options.deadline) {
      stopReason = 'max runtime reached';
      break;
    }
    const url = buildTodayTimelineUrl({ queryId, operationName, count, cursor });
    const json = await fetchXGraphqlJson({ url, headers, fetchImpl: options.fetchImpl });
    const page = parseTodayTimelineResponse(json, nowFn());
    pages += 1;
    records.push(...page.records);
    cursor = page.nextCursor;
    if (!cursor) {
      stopReason = 'end of today timeline';
      break;
    }
    if (pages < maxPages) await sleep(delayMs);
  }

  return { records, pages, stopReason, nextCursor: cursor };
}
```

- [ ] **Step 4: Run focused tests and build**

```bash
npm test -- tests/today.test.ts tests/graphql-bookmarks.test.ts
npm run build
```

Expected: Today parser tests pass; existing tweet parser tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/today/fetch.ts tests/today.test.ts
git commit -m "feat: fetch today timeline via X GraphQL"
```

---

### Task 4: Add Today sync/cache/read helpers

**Files:**
- Create: `src/today/sync.ts`
- Create: `src/today/db.ts`
- Modify: `tests/today.test.ts`

- [ ] **Step 1: Add cache merge/read tests**

Append to `tests/today.test.ts`:

```ts
import { readJson } from '../src/fs.js';
import { listToday, getTodayById, getTodayStats } from '../src/today/db.js';
import { mergeTodayRecords, syncToday } from '../src/today/sync.js';
import type { TodayRecord } from '../src/today/types.js';

function todayRecord(id: string, text = `record ${id}`): TodayRecord {
  return {
    id,
    tweetId: id,
    url: `https://x.com/alice/status/${id}`,
    text,
    authorHandle: 'alice',
    authorName: 'Alice',
    postedAt: '2026-06-24T10:00:00.000Z',
    bookmarkedAt: null,
    syncedAt: NOW,
    links: [],
    tags: [],
    ingestedVia: 'graphql',
    timelineKind: 'today',
    seenAt: NOW,
  };
}

test('mergeTodayRecords upserts by id and sorts newest seen first', () => {
  const oldRecord = { ...todayRecord('1'), seenAt: '2026-06-24T10:00:00.000Z', text: 'old' };
  const newRecord = { ...todayRecord('1'), seenAt: '2026-06-24T11:00:00.000Z', text: 'new' };
  const addedRecord = { ...todayRecord('2'), seenAt: '2026-06-24T12:00:00.000Z' };
  const result = mergeTodayRecords([oldRecord], [newRecord, addedRecord]);
  assert.equal(result.added, 1);
  assert.deepEqual(result.merged.map((r) => r.id), ['2', '1']);
  assert.equal(result.merged[1]?.text, 'new');
});

test('syncToday writes cache and meta, and read helpers list/show/stats', async () => {
  const previous = process.env.FT_DATA_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), 'ft-today-sync-'));
  process.env.FT_DATA_DIR = root;
  try {
    const result = await syncToday({
      queryId: 'qid',
      csrfToken: 'csrf',
      cookieHeader: 'ct0=csrf',
      maxPages: 1,
      fetchImpl: async () => Response.json({
        data: { home: { home_timeline_urt: { instructions: [{
          type: 'TimelineAddEntries',
          entries: [{ entryId: 'tweet-300', content: { itemContent: { tweet_results: { result: tweetResult('300') } } } }],
        }] } } },
      }),
      now: () => NOW,
    });

    assert.equal(result.added, 1);
    assert.equal(result.totalToday, 1);
    assert.equal(listToday({ limit: 10 }).items[0]?.id, '300');
    assert.equal(getTodayById('300')?.text, 'Today feed item');
    assert.equal(getTodayStats().total, 1);
    const meta = await readJson<{ count: number; operationName: string }>(todayMetaPath());
    assert.equal(meta.count, 1);
    assert.equal(meta.operationName, 'HomeTimeline');
  } finally {
    if (previous === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous;
  }
});
```

- [ ] **Step 2: Run tests to verify missing modules**

```bash
npm test -- tests/today.test.ts
```

Expected: fail because `sync.ts` and `db.ts` do not exist.

- [ ] **Step 3: Implement `src/today/sync.ts`**

```ts
import { readJson, readJsonLines, writeJson, writeJsonLines, pathExists } from '../fs.js';
import { ensureTodayDir, todayCachePath, todayMetaPath } from './paths.js';
import { fetchToday, DEFAULT_TODAY_OPERATION } from './fetch.js';
import type { TodayMeta, TodayRecord, TodaySyncOptions, TodaySyncResult } from './types.js';

function recordSortTime(record: TodayRecord): number {
  return Date.parse(record.seenAt || record.postedAt || record.syncedAt || '') || 0;
}

export function mergeTodayRecords(existing: TodayRecord[], incoming: TodayRecord[]): { merged: TodayRecord[]; added: number } {
  const byId = new Map(existing.map((record) => [record.id, record]));
  let added = 0;
  for (const record of incoming) {
    if (!byId.has(record.id)) added += 1;
    byId.set(record.id, { ...byId.get(record.id), ...record });
  }
  const merged = Array.from(byId.values()).sort((a, b) => recordSortTime(b) - recordSortTime(a));
  return { merged, added };
}

export async function syncToday(options: TodaySyncOptions = {}): Promise<TodaySyncResult> {
  ensureTodayDir();
  const cachePath = todayCachePath();
  const metaPath = todayMetaPath();
  const existing = options.rebuild ? [] : await readJsonLines<TodayRecord>(cachePath);
  const previousMeta = !options.rebuild && await pathExists(metaPath) ? await readJson<TodayMeta>(metaPath) : undefined;
  const maxMinutes = options.maxMinutes ?? 5;
  const deadline = maxMinutes === Infinity ? undefined : Date.now() + maxMinutes * 60_000;

  options.onProgress?.({ page: 0, totalFetched: 0, newAdded: 0, running: true, done: false });
  const fetchResult = await fetchToday({
    ...options,
    cursor: options.rebuild ? options.cursor : options.cursor ?? previousMeta?.cursor,
    deadline,
  });
  const { merged, added } = mergeTodayRecords(existing, fetchResult.records);
  await writeJsonLines(cachePath, merged);
  const now = new Date().toISOString();
  await writeJson(metaPath, {
    lastUpdated: now,
    cursor: fetchResult.stopReason === 'end of today timeline' ? undefined : fetchResult.nextCursor,
    count: merged.length,
    queryId: options.queryId ?? process.env.FT_TODAY_QUERY_ID,
    operationName: options.operationName ?? DEFAULT_TODAY_OPERATION,
  } satisfies TodayMeta);

  options.onProgress?.({
    page: fetchResult.pages,
    totalFetched: fetchResult.records.length,
    newAdded: added,
    running: false,
    done: true,
    stopReason: fetchResult.stopReason,
  });

  return { added, totalToday: merged.length, pages: fetchResult.pages, stopReason: fetchResult.stopReason, cachePath, metaPath };
}
```

- [ ] **Step 4: Implement `src/today/db.ts`**

```ts
import { readJson, readJsonLines, pathExists } from '../fs.js';
import { todayCachePath, todayMetaPath } from './paths.js';
import type { TodayMeta, TodayRecord } from './types.js';

export interface TodayListOptions {
  limit?: number;
  offset?: number;
  query?: string;
}

function matchesQuery(record: TodayRecord, query: string | undefined): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [record.text, record.authorHandle, record.authorName, ...(record.links ?? [])]
    .filter((value): value is string => typeof value === 'string')
    .some((value) => value.toLowerCase().includes(needle));
}

export async function listToday(options: TodayListOptions = {}): Promise<{ items: TodayRecord[]; total: number; limit: number; offset: number }> {
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100));
  const offset = Math.max(0, options.offset ?? 0);
  const records = (await readJsonLines<TodayRecord>(todayCachePath())).filter((record) => matchesQuery(record, options.query));
  return { items: records.slice(offset, offset + limit), total: records.length, limit, offset };
}

export async function getTodayById(id: string): Promise<TodayRecord | null> {
  const records = await readJsonLines<TodayRecord>(todayCachePath());
  return records.find((record) => record.id === id || record.tweetId === id) ?? null;
}

export async function getTodayStats(): Promise<{ total: number; lastUpdated?: string; operationName?: string }> {
  const records = await readJsonLines<TodayRecord>(todayCachePath());
  const meta: TodayMeta | undefined = await pathExists(todayMetaPath()) ? await readJson<TodayMeta>(todayMetaPath()) : undefined;
  return { total: records.length, lastUpdated: meta?.lastUpdated, operationName: meta?.operationName };
}
```

Update the test calls added in Step 1 to `await listToday(...)`, `await getTodayById(...)`, and `await getTodayStats()`.

- [ ] **Step 5: Run focused tests and build**

```bash
npm test -- tests/today.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add src/today/sync.ts src/today/db.ts tests/today.test.ts
git commit -m "feat: cache today timeline records"
```

---

### Task 5: Add `ft sync-today` CLI

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Import Today sync**

Add near existing sync imports in `src/cli.ts`:

```ts
import { syncToday } from './today/sync.js';
import type { TodaySyncProgress } from './today/types.js';
```

- [ ] **Step 2: Add `sync-today` command**

Add a top-level command near `sync-following`:

```ts
program
  .command('sync-today')
  .description('Fetch the X Today timeline into a local cache')
  .option('--query-id <id>', 'X GraphQL query id for the HomeTimeline operation', process.env.FT_TODAY_QUERY_ID)
  .option('--operation <name>', 'X GraphQL operation name', 'HomeTimeline')
  .option('--browser <id>', 'Browser session to use for X cookies')
  .option('--count <n>', 'Tweets per page', '40')
  .option('--max-pages <n>', 'Maximum pages to fetch', '1')
  .option('--rebuild', 'Ignore saved cursor and rebuild the Today cache from the newest page')
  .action(async (options: { queryId?: string; operation: string; browser?: string; count: string; maxPages: string; rebuild?: boolean }) => {
    const count = Number(options.count);
    const maxPages = Number(options.maxPages);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      console.error('  --count must be an integer from 1 to 100');
      process.exitCode = 1;
      return;
    }
    if (!Number.isInteger(maxPages) || maxPages < 1) {
      console.error('  --max-pages must be a positive integer');
      process.exitCode = 1;
      return;
    }
    const spinner = createSpinner(() => 'Fetching Today timeline…');
    let lastProgress: TodaySyncProgress | undefined;
    spinner.update();
    const result = await runWithSpinner(spinner, () => syncToday({
      queryId: options.queryId,
      operationName: options.operation,
      browser: options.browser,
      count,
      maxPages,
      rebuild: Boolean(options.rebuild),
      onProgress: (progress) => {
        lastProgress = progress;
        spinner.update();
      },
    }));
    console.log('Today sync complete.');
    console.log(`- added: ${result.added}`);
    console.log(`- total today cache: ${result.totalToday}`);
    console.log(`- pages fetched: ${result.pages}`);
    console.log(`- stop reason: ${result.stopReason}`);
    console.log(`- cache: ${result.cachePath}`);
    console.log(`- meta: ${result.metaPath}`);
    if (lastProgress?.stopReason) console.log(`- progress: ${lastProgress.stopReason}`);
  });
```

- [ ] **Step 3: Run build and help smoke test**

```bash
npm run build
node dist/cli.js sync-today --help
```

Expected: build passes; help shows `--query-id`, `--operation`, `--count`, `--max-pages`, and `--rebuild`.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add sync-today command"
```

---

### Task 6: Add Today API routes to the web server

**Files:**
- Modify: `src/web/server.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Add web API tests for Today cache reads**

Append to `tests/web-server.test.ts`:

```ts
test('web API serves today list, stats, and detail from cache', async () => {
  await withTempFieldTheoryData(async () => {
    const todayDir = path.join(process.env.FT_DATA_DIR!, 'today');
    await mkdir(todayDir, { recursive: true });
    await writeFile(path.join(todayDir, 'today.jsonl'), `${JSON.stringify({
      id: 't1',
      tweetId: 't1',
      url: 'https://x.com/alice/status/t1',
      text: 'Today cache item',
      authorHandle: 'alice',
      authorName: 'Alice',
      postedAt: '2026-06-24T10:00:00.000Z',
      syncedAt: '2026-06-24T12:00:00.000Z',
      links: [],
      tags: [],
      ingestedVia: 'graphql',
      timelineKind: 'today',
      seenAt: '2026-06-24T12:00:00.000Z',
    })}\n`);
    await writeFile(path.join(todayDir, 'meta.json'), JSON.stringify({ count: 1, lastUpdated: '2026-06-24T12:00:00.000Z', operationName: 'HomeTimeline' }));

    const server = await startTestServer();
    try {
      const listResponse = await fetch(`${server.baseUrl}/api/today?limit=5`);
      assert.equal(listResponse.status, 200);
      const list = await listResponse.json() as { items: Array<{ id: string }>; total: number };
      assert.equal(list.total, 1);
      assert.equal(list.items[0]?.id, 't1');

      const detailResponse = await fetch(`${server.baseUrl}/api/today/t1`);
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json() as { text: string };
      assert.equal(detail.text, 'Today cache item');

      const statsResponse = await fetch(`${server.baseUrl}/api/today/stats`);
      assert.equal(statsResponse.status, 200);
      const stats = await statsResponse.json() as { total: number };
      assert.equal(stats.total, 1);
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

Expected: Today API calls return 404.

- [ ] **Step 3: Add Today imports and route handlers**

In `src/web/server.ts`, import:

```ts
import { getTodayById, getTodayStats, listToday } from '../today/db.js';
```

Add inside `handleApi()` before the bookmark detail route:

```ts
if (pathname === '/api/today') {
  const limit = parseBoundedInteger(url.searchParams.get('limit'), { defaultValue: 30, min: 1, max: 100 });
  const offset = parseBoundedInteger(url.searchParams.get('offset'), { defaultValue: 0, min: 0, max: 1_000_000 });
  sendJson(res, 200, await listToday({
    limit,
    offset,
    query: optionalParam(url, 'query'),
  }));
  return;
}

if (pathname === '/api/today/stats') {
  sendJson(res, 200, await getTodayStats());
  return;
}

const todayMatch = pathname.match(/^\/api\/today\/([^/]+)$/);
if (todayMatch) {
  const item = await getTodayById(todayMatch[1]);
  if (!item) throw new HttpError(404, 'Today item not found');
  sendJson(res, 200, item);
  return;
}
```

- [ ] **Step 4: Run web tests and build**

```bash
npm test -- tests/web-server.test.ts tests/today.test.ts
npm run build
```

Expected: tests and build pass.

- [ ] **Step 5: Commit**

```bash
git add src/web/server.ts tests/web-server.test.ts
git commit -m "feat: serve today feed API"
```

---

### Task 7: Add Today lane to the web UI

**Files:**
- Modify: `src/web/app-shell.ts`
- Modify: `tests/web-server.test.ts`

- [ ] **Step 1: Extend app shell smoke test**

Update the existing app-shell test in `tests/web-server.test.ts` to include Today markers:

```ts
assert.match(html, /data-lane="bookmarks"/);
assert.match(html, /data-lane="today"/);
assert.match(appJs, /fetchToday/);
```

- [ ] **Step 2: Run test to verify failure**

```bash
npm test -- tests/web-server.test.ts
```

Expected: app shell test fails because Today UI is not present.

- [ ] **Step 3: Add lane buttons to HTML shell**

In `renderAppShell()` inside `.sidebar`, after `<h1>X Bookmarks</h1>` add:

```html
<nav class="lanes" aria-label="Feed lanes">
  <button class="lane active" type="button" data-lane="bookmarks">Bookmarks</button>
  <button class="lane" type="button" data-lane="today">Today</button>
</nav>
```

- [ ] **Step 4: Add CSS for lanes**

Append to `appCss`:

```css
.lanes { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:0 0 18px; }
.lane { border:1px solid var(--line); background:#0b1220; color:var(--muted); border-radius:14px; padding:10px; cursor:pointer; }
.lane.active { border-color:var(--accent); color:var(--accent); background:#10243a; }
```

- [ ] **Step 5: Update browser JS lane state**

In `appJs`, change the initial state and fetch functions:

```js
const state = { lane:'bookmarks', query:'', category:'', domain:'', folder:'', offset:0, limit:30, total:0, loading:false };
```

Add:

```js
function endpoint() {
  return state.lane === 'today' ? '/api/today' : '/api/bookmarks';
}

async function fetchToday(reset = false) {
  return fetchBookmarks(reset);
}
```

Change the fetch URL in `fetchBookmarks()`:

```js
const data = await fetchJson(endpoint() + '?' + params(reset));
```

Add lane button listeners near the bottom:

```js
for (const button of document.querySelectorAll('[data-lane]')) {
  button.addEventListener('click', () => {
    state.lane = button.dataset.lane;
    state.offset = 0;
    for (const other of document.querySelectorAll('[data-lane]')) other.classList.toggle('active', other === button);
    results.replaceChildren();
    fetchBookmarks(true);
  });
}
```

Keep bookmark filters visible for v1; they simply do not affect Today except `query`, `limit`, and `offset` because `/api/today` ignores category/domain/folder.

- [ ] **Step 6: Run web tests and build**

```bash
npm test -- tests/web-server.test.ts
npm run build
```

Expected: app shell smoke test and build pass.

- [ ] **Step 7: Commit**

```bash
git add src/web/app-shell.ts tests/web-server.test.ts
git commit -m "feat: add today lane to web UI"
```

---

### Task 8: Refactor bookmarks to shared GraphQL transport without behavior changes

**Files:**
- Modify: `src/graphql-bookmarks.ts`
- Test: `tests/graphql-bookmarks.test.ts`, `tests/x-graphql.test.ts`

- [ ] **Step 1: Replace duplicated constants and session resolution**

In `src/graphql-bookmarks.ts`, import:

```ts
import {
  buildXGraphqlGetUrl,
  buildXGraphqlHeaders,
  fetchXGraphqlJson,
  resolveXBrowserSession,
  XRateLimitError,
} from './x-graphql.js';
```

Remove private duplicates only after all usages are replaced:

- `CHROME_UA`
- `X_PUBLIC_BEARER`
- private `buildHeaders()`
- private `RateLimitError`
- private `parseRetryAfterSec()`

- [ ] **Step 2: Update bookmark URL builders to use shared URL builder**

Replace `buildUrl()`, `buildFoldersListUrl()`, and `buildFolderTimelineUrl()` internals with `buildXGraphqlGetUrl(...)` while preserving the same variables/features and returning string or URL consistently.

- [ ] **Step 3: Update fetch page functions to call shared retrying fetch**

In `fetchPageWithRetry()` and `fetchFolderPage()`, replace raw `fetch()` retry loops with:

```ts
const json = await fetchXGraphqlJson({
  url: buildUrl(cursor, pageSize),
  headers: buildXGraphqlHeaders({ csrfToken, cookieHeader: cookieHeader ?? `ct0=${csrfToken}` }),
});
return parseBookmarksResponse(json);
```

For folder timeline, call `parseFolderTimelineResponse(json)`.

Preserve the existing user-friendly 401/403 message if current tests assert it. If tests do not assert it, accept the shared message.

- [ ] **Step 4: Update session resolution in `syncBookmarksGraphQL()`**

Replace browser-specific cookie extraction with:

```ts
const session = resolveXBrowserSession(options);
csrfToken = session.csrfToken;
cookieHeader = session.cookieHeader;
```

- [ ] **Step 5: Run full GraphQL test suite**

```bash
npm test -- tests/graphql-bookmarks.test.ts tests/x-graphql.test.ts tests/following.test.ts tests/today.test.ts
npm run build
```

Expected: all tests and build pass.

- [ ] **Step 6: Commit**

```bash
git add src/graphql-bookmarks.ts tests/graphql-bookmarks.test.ts
git commit -m "refactor: use shared X GraphQL transport for bookmarks"
```

---

### Task 9: Final verification and manual smoke test

**Files:**
- Modify only if verification reveals bugs.

- [ ] **Step 1: Run full automated verification**

```bash
npm run build
npm test
```

Expected: both commands pass.

- [ ] **Step 2: Verify CLI help**

```bash
node dist/cli.js sync-today --help
node dist/cli.js serve --help
```

Expected: both commands print help without crashing.

- [ ] **Step 3: Manual Today sync with explicit query id**

Run with a verified current X query ID:

```bash
FT_TODAY_QUERY_ID='<verified-query-id>' node dist/cli.js sync-today --max-pages 1
```

Expected:

- Command prints `Today sync complete.`
- `~/.fieldtheory/bookmarks/today/today.jsonl` exists.
- `~/.fieldtheory/bookmarks/today/meta.json` exists.

- [ ] **Step 4: Manual web smoke test**

```bash
node dist/cli.js serve --port 3000
```

Open `http://127.0.0.1:3000` and verify:

- Bookmarks lane still works.
- Today lane loads cached Today items.
- Today search filters cached Today records.
- Details drawer opens for a Today item.
- Browser console has no errors.

- [ ] **Step 5: Commit any verification fixes**

```bash
git status --short
git add src tests
git commit -m "fix: stabilize today feed integration"
```

---

## Acceptance Criteria

1. `ft sync-today --query-id <id> --max-pages 1` fetches X timeline records with browser-cookie GraphQL auth.
2. Today data is cached under `~/.fieldtheory/bookmarks/today/` and does not mutate bookmarks or canonical tables.
3. Existing bookmark sync and following sync still pass their tests after shared GraphQL extraction.
4. `/api/today`, `/api/today/:id`, and `/api/today/stats` serve cached Today data on localhost.
5. The web UI has Bookmarks and Today lanes, with the existing bookmark lane behavior preserved.
6. `npm run build` and `npm test` pass.

## Deferred Work

- Auto-discover Today/HomeTimeline query ID from the X web bundle.
- Add a secure browser-triggered Today sync button with a per-process token and progress polling/SSE.
- Index Today into SQLite/FTS if cached Today grows beyond what JSONL filtering can handle.
- Add ranking, grouping, and “why this is relevant today” summarization.
