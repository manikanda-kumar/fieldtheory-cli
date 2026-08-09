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

### Next

- Commit the three unpushed local changes (16dd2c3, 8bd899e already committed; index fix + ask feature still in working tree).
- Remaining UI gap: library markdown (YouTube notes bodies, daily digests, wiki pages, ideas) is still NOT in the web search index — only canonical bookmark rows are. Ask reads wiki pages, but Library search cannot.

## Open questions

## Working set (files/ids/commands)

## Activity log

## Project learnings

