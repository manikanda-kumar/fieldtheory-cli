# Continuity Ledger

## Goal (incl. success criteria)

Ship the leftover daily “Also saved” summaries + X status-mirror folding onto current main (already has the Tweetsmash overlay).

## Constraints/Assumptions

- Preserve the daily rolling watermark and historical digest content.
- Leave pre-existing untracked `.harness/runs/` and `undefined/` paths untouched.
- Tweetsmash overlay already on main (`b5a1f84`); do not regress it.

## Key decisions

- Daily “Also saved” uses `dailyItemSummary()` instead of leftover indexing metadata.
- Raindrop X status mirrors fold into the rich X bookmark via tweet id.
- Grounded enrichment can summarize auth-walled X links from saved context without fetching the wall.

## State

### Done

- 2026-08-13: Tweetsmash semantic overlay shipped to `origin/main` as `b5a1f84`.

- 2026-08-13: Added summaries to Markdown/HTML “Also saved” rows, X/Twitter status-mirror canonical folding, richer X titles, and grounded enrichment for auth-walled thin X links.

- Shipped `ft x-list-summary <list>`: src/x-list-summary.ts (LLM briefing via engine chain w/ FT_DAILY_* env, mechanical fallback, skip-unless-force), CLI wiring, sync-all step 'x-list-summary' (source x-list, after fetch, disabled by --no-synthesis), tests/x-list-summary.test.ts (5 tests; suite 968/968), dist rebuilt, live run OK → ~/.fieldtheory/library/daily/x-list/2026-08-08.md + <listId>-summary-latest.md (grok/grok-4.5, 80/1050 tweets in prompt). Docs updated in docs/x-list-digest-prototype.md.

### Now

- Daily “Also saved” + X-mirror folding verified (999/999) on `fix/daily-also-saved-summaries-ship`.

### Next

- None.

## Open questions

- None.

## Working set (files/ids/commands)

- `src/{url-normalize,canonical-bookmarks-db,cli}.ts`, `src/daily/{enrich,html,synthesize}.ts`, `tests/{canonical-bookmarks-db,daily}.test.ts`

## Activity log

- 2026-08-11: daily sync-all ran 09:06:10 → 23:28:47 (exit=1). All steps ✓ except `ft x-list 1979812953135497678 --since-hours 24` (failed after 3 attempts). x-list-summary still "succeeded" off stale `1979812953135497678-latest.json` (mtime 10 Aug 14:07), so `library/daily/x-list/2026-08-11.md` is byte-identical to 08-10 except the date — silent stale-data bug worth fixing (summary should skip/flag when latest.json is older than the target date).

## Project learnings

- No browser MCP tool loaded in some sessions; drive local pages with `node ~/snippets/browser-cdp-probe.mjs <url> --eval '<js>' --shot out.png` (raw CDP over Node's WebSocket + the playwright cache's chrome-headless-shell).
