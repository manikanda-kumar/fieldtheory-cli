# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T182744Z-qwa9vn
- Backend: codex
- Task type: review
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: read-only-by-default
- Model: gpt-5.6-terra

## Objective

Review the uncommitted link-enrichment changes: src/llm/opencode-client.ts (new), src/daily/enrich.ts (new), plus edits in src/cli.ts, src/daily/synthesize.ts, src/daily/coverage.ts, tests. Context: thin bookmarks (bare links) get fetched + summarized via deepseek-v4-flash on OpenCode Zen Go, summary merged into searchText before connect/synthesis; failures fall back to the thin-skip path; cache table link_enrichment must survive rebuildCanonicalIndex. Hunt for: (1) any path where enrichment failure/timeout can fail or hang the digest (missing AbortController cleanup, unhandled rejection in the concurrency pool), (2) SSRF-ish or unbounded fetch issues: redirects to localhost/file, body read cap actually enforced, (3) cache correctness: failed rows retried only after 7d, ok rows never refetched, table untouched by canonical rebuild DELETEs, (4) searchText merge mutating shared objects unexpectedly (connect and synthesize see consistent view; digest snippet may leak 'summary:' prefix — acceptable?), (5) key handling: key never logged, (6) counts honest (enriched definition consistent between footer and frontmatter), (7) prompt-partition interaction: enriched item whose summary is still short stays thin — handled? file:line findings ranked; 'no findings' if clean. Do not edit.

## Scope

Use the objective and named files as scope. Do not broaden unless required.

## Constraints

- Match existing repo patterns.
- Do not commit changes.
- If changing files, report exact files changed.
- If validation cannot run, say why.

## Expected deliverable

1. Summary
2. Evidence
3. Files changed
4. Commands run
5. Verification status
6. Blockers

## Result shape

summary: string
evidence: string[]
files_changed: string[]
commands_run: { command: string, exit_code: number | null, summary: string }[]
verification: { status: "passed" | "failed" | "not_run", details: string }
blockers: string[]
