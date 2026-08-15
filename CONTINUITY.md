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

- `fix/sync-all-transient-retries` pushed to origin (d608bdb grok-4.6 default, 369bdc7 transient-network retries). Not merged to main; no PR opened.

### Next

- Merge/PR the branch, then watch the next nightly run for RSS 98/98, zero YouTube `terminated`, and `synthesis: llm` on the x-list summary.

## Open questions

- None.

## Working set (files/ids/commands)

- `src/{url-normalize,canonical-bookmarks-db,cli}.ts`, `src/daily/{enrich,html,synthesize}.ts`, `tests/{canonical-bookmarks-db,daily}.test.ts`

## Activity log

- 2026-08-15: fixed the 08-14/15 run's failure classes. New `src/net-retry.ts` (`isTransientNetworkError` + `retryTransient`, 3 attempts, 1s→3s backoff) wired into: RSS (`rss/sync.ts` per-feed retry, `rss/client.ts` timeout 20s→30s), YouTube (`youtube/fetch.ts` fetchText + `youtube/playlist.ts` get 30s AbortSignal.timeout + retry), and `cli.ts` sync-youtube (per-video retry, attempts 2, so one dropped socket no longer replays all 8 videos). `x-list-summary` LLM timeout 300s→600s (FT_DAILY_TIMEOUT_MS still overrides). `~/.fieldtheory/sync-all.sh` gained a PID-file single-instance guard (stale-pid safe, trap-cleaned). Tests: `tests/net-retry.test.ts` (5) + 3 RSS retry tests; suite 1007/1007. Live `ft sync-rss` → 98/98 ok. Uncommitted.

- 2026-08-15: grok engine default bumped `grok-4.5` → `grok-4.6` (live default per ~/.grok/models_cache.json, 500k ctx). Changed `src/engine.ts` GROK_DEFAULT_MODEL, `src/cli.ts` --model help text, README, tests (engine/daily/daily-index-html), and `~/.fieldtheory/sync-all.sh` FT_DAILY_MODEL default. Build ✓, 999/999 ✓, live `grok -p --model grok-4.6` ✓. Uncommitted.

- 2026-08-15: checked today's run. Latest sync-all started 08-14 09:12:46, exit=0 at 08-15 10:44:49 (~25.5h wall). No separate 08-15 09:00 start — prior run still active, so daily launch effectively skipped/overlapped. Digest `library/daily/2026-08-15.md` written (77 new items, 7 themes, synthesis=llm/grok, 3 reviews due). Non-fatal failures: 3× `Error: fetch failed`; x-list-summary `llm failed: grok timed out after 300s` (mechanical fallback, wrote x-list/2026-08-14.md); RSS 93/98 ok (5 aborted: crawshaw, Evan Hahn, Geoffrey Huntley, Geoffrey Litt, Marc Brooker); YouTube 5 "failed: terminated" across passes, final pass 8/8 ok. NotebookLM push OK.

- 2026-08-11: daily sync-all ran 09:06:10 → 23:28:47 (exit=1). All steps ✓ except `ft x-list 1979812953135497678 --since-hours 24` (failed after 3 attempts). x-list-summary still "succeeded" off stale `1979812953135497678-latest.json` (mtime 10 Aug 14:07), so `library/daily/x-list/2026-08-11.md` is byte-identical to 08-10 except the date — silent stale-data bug worth fixing (summary should skip/flag when latest.json is older than the target date).

## Project learnings

- No browser MCP tool loaded in some sessions; drive local pages with `node ~/snippets/browser-cdp-probe.mjs <url> --eval '<js>' --shot out.png` (raw CDP over Node's WebSocket + the playwright cache's chrome-headless-shell).
