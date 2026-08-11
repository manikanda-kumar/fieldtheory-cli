# Continuity Ledger

## Goal (incl. success criteria)

Daily summary of X list 1979812953135497678 as part of daily work: `ft x-list-summary` command + sync-all step so the 09:00 launchd job (dev.fieldtheory.sync-all-daily) produces a markdown briefing every day.

## Constraints/Assumptions

## Key decisions

- Summary implemented as separate sync-all step reading <listId>-latest.json rather than folding list tweets into the canonical daily digest — keeps the 1000+-tweet firehose out of the bookmark index and reuses existing x-list-store ranking helpers.

## State

### Done

- Shipped `ft x-list-summary <list>`: src/x-list-summary.ts (LLM briefing via engine chain w/ FT_DAILY_* env, mechanical fallback, skip-unless-force), CLI wiring, sync-all step 'x-list-summary' (source x-list, after fetch, disabled by --no-synthesis), tests/x-list-summary.test.ts (5 tests; suite 968/968), dist rebuilt, live run OK → ~/.fieldtheory/library/daily/x-list/2026-08-08.md + <listId>-summary-latest.md (grok/grok-4.5, 80/1050 tweets in prompt). Docs updated in docs/x-list-digest-prototype.md.

### Now

- 2026-08-09 PM: Shipped date-indexed archive pages (repojournal-style "pick a date"): src/daily/index-html.ts (scan dir of YYYY-MM-DD.md → numbered newest-first list, month headings, Today badge, items/themes/engine meta, theme preview), wired non-fatally into daily --write + x-list-summary. Committed 16dd2c3 (971/971 tests, dist rebuilt), NOT pushed. Live: library/daily/index.html (33 days) + x-list/index.html, visually verified. Prior perf commit 8bd899e also unpushed.

- 2026-08-09 (later): Search UI audit. `ft serve` (src/web/server.ts + app-shell.ts, 1719 lines) already serves unified search over canonical index (x 10765, raindrop 13741, rss 7397, github-stars 2503, youtube 506, project 158). Found + fixed perf bug: source-filtered list/count took 102s (correlated EXISTS drove off idx_bookmark_sources_source, scanning ~10k source rows per canonical row). Added idx_bookmark_sources_canonical_source(canonical_id, source) in initCanonicalSchema → 17ms / 0.15s per API call. 971/971 tests, dist rebuilt, NOT committed.

- 2026-08-09 (later still): Shipped "Ask library" in `ft serve` (chosen option 3). New src/web/ask.ts (SSE stream at GET /api/ask?query=&save=1, single-flight latch, non-interactive engine pick via prefs/detect, 400/405/429/503 statuses), openSse() in web/http.ts, createBookmarkWebServer(deps) injectable for tests, md-ask accepts an engine profile. Frontend: Ask nav lane + header button, fetch-based SSE reader (not EventSource: it hides status and auto-reconnects), progress log, markdown-lite answer render, pages-read/wiki-update sections, ask CSS. Two bugs found and fixed en route: sanitizeFtsQuery let a trailing "?" through (fts5 syntax error — broke every natural-language ask and any punctuated Library search), and .load-more's display:block beat the hidden attribute. md-ask now falls back to findRelatedCanonicalBookmarks (OR of content words) when the sentence-as-AND query returns nothing. 977/977 tests, dist rebuilt, browser-verified light+dark with a real codex run. NOT committed.

- 2026-08-09: Pushed main → origin at 12b524e (5 commits: 8bd899e perf, 16dd2c3 daily archive pages, 3fce61d source index, bc4a8eb FTS punctuation fix, 12b524e Ask lane). Working tree clean apart from untracked .harness/runs/.

- 2026-08-11: CLOSED the library-markdown search gap. New second FTS archive `~/.fieldtheory/bookmarks/library.db` (src/library-index-db.ts: library_docs + library_docs_fts external-content, porter unicode61, bm25 title 10 / tags 4 / body 1; incremental by mtime+size then one 'rebuild'; excludes library/bookmarks/ because those duplicate canonical rows; 1368 docs, ~15MB, 1.4s cold build). Wiring: src/md-tags.ts (tag helpers shared out of navigation.ts), libraryIndexPath() in paths.ts, `ft library-index [--force|--stats|--json]`, third stage in `ft index`, `ft grep` now FTS-first with `--scan` escape hatch, web routes /api/library-docs, /api/library-doc?id=, /api/library-docs/stats (ensureLibraryIndexFresh 5s-throttled stat sweep on read). UI: "From your notes" group at the top of the Library lane, ranked inside its own archive (bm25 across two FTS tables is not comparable, so never merged), "Read note" opens the rendered markdown in the detail pane with frontmatter stripped. md-ask now adds up to 3 library-body FTS hits to the wiki pages it reads, each page truncated to 8000 chars. Tests: tests/library-index-db.test.ts (6) + 2 web-server tests; suite 985/985, dist rebuilt, browser-verified via raw CDP.

### Next

- 2026-08-11 review of github.com/opentrawl/opentrawl (Go, local-first, per-app SQLite archives + federated `trawl` CLI) for design ideas. Takeaways worth stealing, in order: (1) federated search over N archives instead of one schema — lets library markdown become its own FTS archive rather than a shoehorned bookmark row; (2) globally routable links (trawler id + stable alias) + `trawl open LINK` so agents/answers can cite and re-open anything; (3) self-describing manifest — bare `trawl` lists sources/capabilities/privacy boundary, agents told to run `--help` instead of reading a doc that drifts; (4) typed partial failure + exit code 3 (partial-with-usable-output); (5) explicit `update` vs read-only reads. Not worth copying: their ranking is recency-only, no bm25, no cross-source dedupe (we have both).

## Open questions

## Working set (files/ids/commands)

## Activity log

## Project learnings

- No browser MCP tool loaded in some sessions; drive local pages with `node ~/snippets/browser-cdp-probe.mjs <url> --eval '<js>' --shot out.png` (raw CDP over Node's WebSocket + the playwright cache's chrome-headless-shell).

