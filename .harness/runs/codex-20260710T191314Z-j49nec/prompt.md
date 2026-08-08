# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T191314Z-j49nec
- Backend: codex
- Task type: implement
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: write-enabled
- Model: gpt-5.6-terra

## Objective

Extend the link-enrichment feature (src/daily/enrich.ts, link_enrichment cache table) with backlog coverage. Two parts:

1. New CLI command 'ft enrich-backfill' in src/cli.ts:
   - Walks ALL canonical_bookmarks rows that are enrichment-eligible (same eligibility as enrichThinItems: thin per contentLength < THIN_CONTENT_CHARS, http(s) canonical_url, not an x.com/twitter.com status URL) and not already status=ok in link_enrichment (failed rows respect the existing 7-day retry rule).
   - Reuses enrichThinItems machinery (or a shared core) — same SSRF guards, timeouts, concurrency 4, caching. Do not duplicate fetch/summarize logic.
   - Options: --limit <n> (default 100 per invocation), --dry-run (print eligible/pending counts and exit), --all (no limit cap). Progress line every 25 items (processed/ok/failed). Resumable by design: rerunning skips cached ok rows.
   - Exit summary: eligible, attempted, ok, failed, skipped-cached.
2. Merge summaries into the canonical index: in rebuildCanonicalIndex (src/canonical-bookmarks-db.ts), after building canonical groups, append cached ok summaries (link_enrichment, matched by canonical url) to that row's search_text (' summary: <text>') before insert, so FTS search/research/connect all see enriched content. Must not break when the table is empty/missing. Note: ft daily's in-memory merge at collect time then becomes redundant for already-indexed summaries — keep it (harmless, covers not-yet-reindexed items) but add a comment.
3. Tests: backfill dry-run counts; backfill enriches an eligible row via seams and skips it on rerun; rebuild merges an ok summary into search_text and FTS finds the item by a summary-only term; empty table no-op. Use existing patterns.

Run node --import tsx --test tests/daily.test.ts tests/canonical-bookmarks-db.test.ts tests/cli.test.ts && npm run build. Concise summary.

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
