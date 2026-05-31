# GitHub Stars Sync Design

## Summary

Add GitHub starred repositories as a first-class Field Theory source. The v1 scope is bookmark-style sync: fetch starred repositories, store a structured local cache, merge them into the unified canonical bookmark index, and export useful GitHub-repository Markdown pages for search, wiki synthesis, and agents.

The design intentionally avoids README enrichment, inferred summaries, unstar tracking, and repo scoring in v1. It stores only GitHub API metadata and leaves room for richer repository intelligence later.

## Goals

- Add `ft sync-github-stars` as an explicit source sync command.
- Support both local `gh` CLI authentication and token-based authentication.
- Sync incrementally by default, with `--rebuild` for full refreshes.
- Store GitHub stars in a source-specific raw cache under the Field Theory data directory.
- Include GitHub stars in the canonical unified index next to X, Raindrop, and YouTube sources.
- Make GitHub stars work with existing unified commands:
  - `ft search --unified`
  - `ft list --unified --source github-stars`
  - `ft show --unified <id>`
  - `ft md --canonical --source github-stars`
  - `ft wiki`
- Export deterministic, metadata-only Markdown pages optimized for agents and later wiki synthesis.

## Non-goals

- No README fetching or summarization in v1.
- No LLM-generated repository summaries in v1.
- No unstar detection or inactive-star state in v1.
- No GitHub GraphQL dependency unless REST cannot satisfy a requirement.
- No new canonical DB tables beyond using existing `bookmark_sources` and `canonical_bookmarks`.
- No automatic inclusion in `ft sync` yet. The command should be shaped so a future `ft sync --all` can call it.

## User interface

Add:

```bash
ft sync-github-stars
```

Options:

```bash
ft sync-github-stars --rebuild
ft sync-github-stars --dry-run
ft sync-github-stars --limit 200
ft sync-github-stars --classify
```

Behavior:

- Default mode is incremental.
- `--rebuild` ignores the incremental checkpoint and fetches all current stars.
- `--dry-run` fetches and reports without writing cache files or rebuilding the canonical index.
- `--limit <n>` caps the number of fetched records for testing or partial runs.
- `--classify` runs canonical regex classification after rebuilding the canonical index.

Successful output should include:

- number fetched
- number added
- number updated
- total cached GitHub stars
- raw cache path
- whether the canonical index was rebuilt

Example:

```text
GitHub Stars sync complete:
  fetched: 43
  added: 12
  updated: 31
  total: 1703
  newest starred_at: 2026-05-31T12:34:56Z
  data: /Users/manik/.fieldtheory/bookmarks/github-stars/stars.jsonl
  ✓ Canonical index rebuilt
```

## Authentication

Support both authentication paths:

1. Prefer the GitHub CLI when `gh` is available and authenticated.
2. Fall back to direct REST requests with `GITHUB_TOKEN` or `GH_TOKEN`.

This gives local convenience while keeping cron and CI usage possible.

The implementation should report auth failures clearly:

- Missing auth: `GitHub authentication not found. Run gh auth login or set GITHUB_TOKEN.`
- Invalid token or expired `gh` session: include the GitHub status and a short remediation hint.

## GitHub API

Use the REST starred repositories endpoint:

```http
GET /user/starred?per_page=100&page=N&sort=created&direction=desc
Accept: application/vnd.github.star+json
```

The custom Accept header is required because it returns `starred_at` along with the repository payload.

### Incremental sync

Read `meta.json.lastStarredAt`. Fetch pages newest-first. Stop when a fetched item has `starred_at <= lastStarredAt`.

Because stars are sorted newest-first, this keeps daily sync fast. `--rebuild` bypasses the stop condition and fetches every page.

### Pagination and limits

- Use `per_page=100`.
- Continue until an empty page, a page with fewer than `per_page` items, the incremental cutoff is reached, or `--limit` is satisfied.
- On rate limits or 5xx responses, retry with bounded exponential backoff.
- On 401/403 auth failures, fail fast with a clear message.

## Local storage

Add source-specific paths:

```text
~/.fieldtheory/bookmarks/github-stars/
  stars.jsonl
  meta.json
```

Record cache is JSONL, one repository per line. Upsert by `fullName`.

### Record shape

```ts
interface GitHubStarRecord {
  id: number;
  fullName: string;
  owner: string;
  name: string;
  htmlUrl: string;
  description: string | null;
  homepageUrl: string | null;
  language: string | null;
  topics: string[];
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  isArchived: boolean;
  isFork: boolean;
  defaultBranch: string | null;
  pushedAt: string | null;
  updatedAt: string | null;
  starredAt: string | null;
  syncedAt: string;
}
```

`homepageUrl` is included because GitHub returns it in the repository payload and it is useful as a low-cost link. No homepage content is fetched in v1.

### Metadata shape

```ts
interface GitHubStarsMeta {
  lastSyncAt: string;
  lastStarredAt: string | null;
  totalStars: number;
}
```

## Canonical index integration

Each GitHub star becomes a `bookmark_sources` row:

```ts
{
  id: `github-stars:${record.id}`,
  source: 'github-stars',
  profile: null,
  sourceItemId: String(record.id),
  sourceUrl: record.htmlUrl,
  targetUrl: null,
  dedupeKey: dedupeKeyForUrl(record.htmlUrl),
  title: record.fullName,
  text: compactText([
    record.fullName,
    record.description,
    record.language,
    record.topics.join(' '),
    record.owner,
  ]),
  authorHandle: record.owner,
  savedAt: record.starredAt,
  createdAt: null,
  modifiedAt: record.updatedAt ?? record.pushedAt,
  folderPath: record.language
    ? ['GitHub Stars', record.language]
    : ['GitHub Stars'],
  links: [
    `https://github.com/${record.owner}`,
    record.homepageUrl,
    `${record.htmlUrl}/issues`,
    record.defaultBranch ? `${record.htmlUrl}/tree/${record.defaultBranch}` : null,
  ].filter(Boolean),
}
```

Use `source = 'github-stars'` consistently in code, tests, and CLI examples.

### Multi-source canonical rows

A GitHub repository may also exist in Raindrop or be linked from X. Canonical dedupe by URL should merge these into one canonical row with multiple source rows. Search/list formatting and Markdown export should preserve all sources rather than choosing a single source through `if/else` logic.

## Markdown export

`ft md --canonical --source github-stars` should emit GitHub-repository-specific Markdown when a canonical item includes a GitHub star source.

The export remains deterministic and metadata-only. It must not invent use cases, summaries, or importance beyond fields returned by GitHub.

### Frontmatter

```yaml
---
title: "owner/repo"
url: "https://github.com/owner/repo"
source: github-stars
sources:
  - github-stars
item_type: github_repository

repo: "owner/repo"
owner: "owner"
name: "repo"
github_id: "123456789"

description: "Repository description from GitHub."
language: "TypeScript"
topics:
  - cli
  - markdown
  - knowledge-management

stargazers_count: 12345
forks_count: 678
open_issues_count: 12
is_archived: false
is_fork: false
default_branch: "main"

saved_at: "2026-05-31T12:34:56Z"
starred_at: "2026-05-31T12:34:56Z"
pushed_at: "2026-05-20T10:00:00Z"
updated_at: "2026-05-25T09:00:00Z"
synced_at: "2026-05-31T13:00:00Z"

domain: github.com
---
```

Rules:

- Quote string values that may contain punctuation.
- Omit optional fields when absent rather than writing placeholders.
- Keep volatile counts out of filenames.
- Use `saved_at` for source-agnostic bookmark semantics and `starred_at` for GitHub-specific semantics.

### Body

```md
# owner/repo

> Repository description from GitHub.

## Repository context

- Repository: [owner/repo](https://github.com/owner/repo)
- Owner: [owner](https://github.com/owner)
- Primary language: TypeScript
- Topics: `cli`, `markdown`, `knowledge-management`
- Default branch: `main`
- Status: not archived; not a fork

## Signals

- Starred: 2026-05-31T12:34:56Z
- Stars: 12,345
- Forks: 678
- Open issues: 12
- Last pushed: 2026-05-20T10:00:00Z
- Last updated: 2026-05-25T09:00:00Z

## Links

- [Repository](https://github.com/owner/repo)
- [Owner](https://github.com/owner)
- [Homepage](https://example.com)
- [Default branch](https://github.com/owner/repo/tree/main)
- [Issues](https://github.com/owner/repo/issues)

## Related

- [[domains/github-com]]
- [[entities/github-owner]]
```

Rules:

- Omit the description blockquote if no description exists.
- Omit language/topics bullets when absent.
- Keep language and topics as plain text in v1. Do not emit `[[languages/...]]` or `[[github-topics/...]]` wikilinks until the wiki generator knows how to create those pages and lint them.
- Related wikilinks should stay conservative to avoid broken-link churn.

## Existing tooling reference

Prior scripts in `~/Github/tools` are useful references, not runtime dependencies:

- `tools/scripts/discovery/gh_stars_export.py`
  - demonstrates `Accept: application/vnd.github.star+json`
  - demonstrates incremental `starred_at` cutoff
  - uses `gh api user/starred?per_page=100&page=N&sort=created&direction=desc`
- `tools/skills/github-repos-skill/update-repos.sh`
  - demonstrates simple `gh api user/starred --paginate` export

The Field Theory implementation should be native TypeScript so it remains packageable and testable with the rest of the CLI.

## File/module plan

Expected new files:

- `src/github-stars/types.ts`
- `src/github-stars/paths.ts`
- `src/github-stars/client.ts`
- `src/github-stars/sync.ts`

Expected edited files:

- `src/cli.ts`
- `src/canonical-bookmarks-db.ts`
- `src/md-export.ts`
- `src/paths.ts` only if needed for path reporting
- `README.md` for command documentation

## Testing plan

### Unit tests

- GitHub client parses `starred_at` REST responses.
- GitHub client paginates until empty page or cutoff.
- GitHub client prefers `gh` when available and falls back to token auth.
- Token auth sends the required `Accept: application/vnd.github.star+json` header.
- Sync upserts records by `fullName`.
- Sync updates `meta.lastStarredAt` to newest seen star.
- Sync honors `--dry-run`, `--limit`, and `--rebuild`.

### Canonical tests

- GitHub star rows become `bookmark_sources.source = 'github-stars'`.
- GitHub stars dedupe by repository URL.
- `listCanonicalBookmarks({ source: 'github-stars' })` returns GitHub star rows.
- Unified search finds a GitHub star by description, language, topic, and owner/repo name.
- A GitHub star and Raindrop item for the same repo produce one canonical row with multiple sources.

### Markdown tests

- `ft md --canonical --source github-stars` exports repo metadata frontmatter.
- Markdown body includes Repository context, Signals, Links, and conservative Related sections.
- Missing optional fields are omitted cleanly.
- Multi-source canonical rows emit a `sources` list rather than losing non-GitHub sources.

### Verification

- `npm run build`
- `npm test`
- Manual smoke:
  ```bash
  ft sync-github-stars --dry-run --limit 5
  ft sync-github-stars --limit 20 --classify
  ft list --unified --source github-stars
  ft search --unified "agent memory"
  ft md --canonical --source github-stars --limit 5
  ft lint
  ```

## Error handling

- Missing GitHub auth should fail before network fetch.
- `gh` not installed should not fail if token auth is available.
- `gh` auth failure should fall back to token auth if a token exists.
- API rate limits should retry with bounded backoff and then fail clearly.
- Malformed or missing repo URLs should skip that record with a warning count.
- Cache writes should be atomic via existing JSONL write helpers.

## Future extensions

- README fetching and README-derived summaries.
- Topic/language wiki pages such as `github-topics/agents` or `languages/typescript`.
- Repo activity scoring using pushed date, stars, archive/fork flags, and issue counts.
- Explicit unstar tracking.
- `ft sync --all` orchestration across X, Raindrop, GitHub stars, and other sources.
- GitHub release/watch/fork ingestion if stars prove useful as a source.

## Self-review

- No placeholder sections remain.
- Scope is limited to metadata-only GitHub star sync.
- The design follows the existing source-cache plus canonical-index architecture.
- The Markdown template avoids unsupported wiki link namespaces to keep `ft lint` clean.
- Authentication, incremental sync, canonical merge, Markdown export, tests, and error handling are specified with concrete behavior.
