Extend the link-enrichment feature (src/daily/enrich.ts, link_enrichment cache table) with backlog coverage. Two parts:

1. New CLI command 'ft enrich-backfill' in src/cli.ts:
   - Walks ALL canonical_bookmarks rows that are enrichment-eligible (same eligibility as enrichThinItems: thin per contentLength < THIN_CONTENT_CHARS, http(s) canonical_url, not an x.com/twitter.com status URL) and not already status=ok in link_enrichment (failed rows respect the existing 7-day retry rule).
   - Reuses enrichThinItems machinery (or a shared core) — same SSRF guards, timeouts, concurrency 4, caching. Do not duplicate fetch/summarize logic.
   - Options: --limit <n> (default 100 per invocation), --dry-run (print eligible/pending counts and exit), --all (no limit cap). Progress line every 25 items (processed/ok/failed). Resumable by design: rerunning skips cached ok rows.
   - Exit summary: eligible, attempted, ok, failed, skipped-cached.
2. Merge summaries into the canonical index: in rebuildCanonicalIndex (src/canonical-bookmarks-db.ts), after building canonical groups, append cached ok summaries (link_enrichment, matched by canonical url) to that row's search_text (' summary: <text>') before insert, so FTS search/research/connect all see enriched content. Must not break when the table is empty/missing. Note: ft daily's in-memory merge at collect time then becomes redundant for already-indexed summaries — keep it (harmless, covers not-yet-reindexed items) but add a comment.
3. Tests: backfill dry-run counts; backfill enriches an eligible row via seams and skips it on rerun; rebuild merges an ok summary into search_text and FTS finds the item by a summary-only term; empty table no-op. Use existing patterns.

Run node --import tsx --test tests/daily.test.ts tests/canonical-bookmarks-db.test.ts tests/cli.test.ts && npm run build. Concise summary.
