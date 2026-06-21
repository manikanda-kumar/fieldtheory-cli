# X Following Roster with Expertise Index

**Date:** 2026-06-21
**Status:** Implemented

## Goal

Sync the logged-in user's X/Twitter following list, classify each account by
domain and expertise, store it locally for search, and expose CLI commands so
agents can check this roster before broader web research (alongside existing
bookmarks).

## Context

Field Theory already syncs X bookmarks via GraphQL + browser cookies (`ft sync`,
`src/graphql-bookmarks.ts`). This feature adds a second local data surface: the
accounts the user follows, with domain/expertise classification. This forms the
"tier 2" of a local-first research ladder:

1. Bookmarks first — `ft search --unified` (already works)
2. Following roster with expertise — `ft experts search` (this feature)
3. Broader search — external tools (out of scope)

## Design

### Storage

Data lives under `~/.fieldtheory/bookmarks/following/` (respects `FT_DATA_DIR`):

```
following/
  following.jsonl       # raw records (one JSON object per line)
  following.db          # SQLite FTS5 search index
  meta.json             # sync cursor, lastUpdated, count, viewerId
```

### Record shape

```typescript
interface FollowingRecord {
  userId: string;
  handle: string;
  name: string;
  bio?: string;
  profileImageUrl?: string;
  followerCount?: number;
  followingCount?: number;
  verified?: boolean;
  syncedAt: string;
  // classification (nullable until classified)
  domains?: string[];
  primaryDomain?: string;
  expertise?: string[];
  expertiseSummary?: string;
  bookmarkOverlap?: number;
}
```

### GraphQL Following endpoint

The X web client fetches a user's following list via the `Following` GraphQL
operation. Query ID and operation details sourced from twscrape's maintained
operation list (June 2026):

- **Query ID:** `OLm4oHZBfqWx8jbcEhWoFw`
- **Operation:** `Following`
- **URL:** `https://x.com/i/api/graphql/<queryId>/Following`
- **Variables:** `{ userId, count, includePromotedContent: false, cursor? }`
- **Response path:** `data.user.result.timeline.timeline.instructions` →
  `TimelineAddEntries` entries containing `content.itemContent.user_results.result`
  (single-user) or `content.items[].item.itemContent.user_results.result`
  (multi-user module)
- **Cursor:** `cursor-bottom-*` entry `content.value`

The query ID is configurable via `--query-id` because X changes it with bundle
updates.

### Viewer ID resolution

The logged-in user's ID is extracted from the `twid` cookie, which encodes it as
URL-encoded JSON `"u=<userId>"`. The Chrome and Firefox cookie extraction
functions (`extractChromeXCookies`, `extractFirefoxXCookies`) were extended to
also extract the `twid` cookie alongside `ct0` and `auth_token`.

### Auth path

Same as `ft sync`: browser session cookies via Chrome/Firefox/Brave. No paid X
API tier required. The `--cookies` flag is supported for manual cookie passing.

### Sync flow

1. Resolve viewer ID from `twid` cookie (or previous meta)
2. Paginate `Following` GraphQL endpoint with cursor
3. Upsert records into `following.jsonl` by `userId`, preserving classification
4. Write `meta.json` with cursor, count, lastUpdated, viewerId
5. Rebuild `following.db` SQLite FTS5 index
6. Optionally classify with `--classify` (LLM) or `--regex`

### Classification

Two modes:

- **LLM (`ft classify-following`):** Uses `resolveEngine()` (claude/codex) to
  classify each account by domains, primaryDomain, expertise[], and
  expertiseSummary. Batches of 50. Reuses `extractJsonArray()` from
  `bookmark-classify-llm.ts` for response parsing.

- **Regex (`ft classify-following --regex`):** Cheap bio-keyword pass using
  domain and expertise keyword lists. No LLM required.

Bookmark overlap is computed from the existing `bookmarks.db`:
`SELECT COUNT(*) FROM bookmarks WHERE author_handle = ?`.

### CLI commands

| Command | Description |
|---------|-------------|
| `ft sync-following` | Sync following list from X |
| `ft sync-following --classify` | Sync + LLM classify |
| `ft sync-following --regex` | Sync + regex classify |
| `ft sync-following --rebuild` | Full re-crawl |
| `ft sync-following --continue` | Resume from saved cursor |
| `ft experts search <query>` | BM25 search over handles, bios, domains, expertise |
| `ft experts list --domain <d>` | Filter by domain, sort by relevance/overlap/followers |
| `ft experts show <handle>` | Full profile + bookmark overlap + top bookmarked posts |
| `ft experts stats` | Total following, classified count, top domains, most-bookmarked |
| `ft classify-following` | LLM classify domains/expertise |
| `ft classify-following --regex` | Regex classify (cheap) |

### Status integration

`ft status --json` includes a `following` block:
```json
{
  "following": {
    "count": 500,
    "classifiedCount": 450,
    "lastUpdated": "2026-06-21T...",
    "cachePath": "~/.fieldtheory/bookmarks/following/following.jsonl"
  }
}
```

### Skill integration

The Field Theory skill (`src/skill.ts`) now documents the local-first research
ladder:
```
ft search --unified "<query>" --json          # tier 1: bookmarks
ft experts search "<query>" --json            # tier 2: trusted accounts
# tier 3: broader web/X research via external tools
```

## Module structure

| File | Purpose |
|------|---------|
| `src/following/types.ts` | FollowingRecord, FollowingMeta, sync option interfaces |
| `src/following/paths.ts` | followingDir(), followingCachePath(), followingIndexPath(), followingMetaPath() |
| `src/following/fetch.ts` | GraphQL Following fetch + viewer ID from twid cookie + response parsing |
| `src/following/db.ts` | SQLite FTS5 index, search, list, show, stats, classification update |
| `src/following/sync.ts` | Sync orchestration: fetch + upsert JSONL + rebuild DB |
| `src/following/classify.ts` | LLM + regex classification for domains/expertise |

## Non-goals (this PR)

- Does not build a "search their recent tweets" pipeline (optional follow-up)
- Does not require a paid X API tier (uses same GraphQL + cookies path as `ft sync`)
- Does not modify grok-cli

## Verification

- `npm run build` — clean
- `npx tsx --test tests/following.test.ts` — 27/27 pass
- `npm test` — 729/730 pass (1 pre-existing engine test failure unrelated to this feature)
