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
- Daily digest presentability pass: themed items in markdown now carry an indented summary line (flows into EPUB as <p class="summary">), "Connects to earlier saves" links get a visible domain suffix in md + HTML byline (closes the deferred CONTINUITY item), dailyItemSummary strips repeated/mid-word title prefixes from searchText, new dailyItemDisplaySummary suppresses title-echo summaries in HTML+md, EPUB .summary styled smaller. Suite 1025/1025, dist rebuilt.
- Verified new digest format live on 2026-08-16 (3 forced --date re-runs, watermark untouched, backup of originals at /tmp/daily-backup-fmt/). Two follow-up summary-quality fixes shipped: dailyItemSummary now drops searchText lines with <3 word-ish tokens (kills topic/language/owner/handle/folder keyword-soup tails) and dedupes repeated lines (feed-title echoes like "Aref — Notes Aref — Notes"). Suite 1025/1025 after each change.

### Now

- Shipped to main: 28eee50 (digest format), 8e6fcdc (fallback chain), 5c15aa2 (Raindrop X hydration). Nothing pending.

- 2026-08-17 nightly run completed (exit=0, 09:13:35 → 19:47:20) but digest fell back to **mechanical** themes: all 4 synthesis engines failed (grok 300s timeout, grok retry 300s timeout, agy 300s timeout, droid → China-hosted opt-in error). No epub for 08-17 (sync-all runs `ft daily --write` without `--epub`). NotebookLM push failed (connection reset).

### Now

- Nothing pending. Shipped today: `c15c285` (nightly `--epub`), `d8d7c63` (boundary-aware recall reveals). 2026-08-18 digest patched in place + epub re-exported.

### Next

- Watch the 2026-08-19 nightly: `--epub` produces 2026-08-19.epub, and the nlm loop pushes all referenced notes without dying.
- Optional: root-cause the nlm push loop dying mid-upload (see 2026-08-18 log entry); it left no FAILED line.
- Optional: add `--hydrate-x` to the sync-raindrop step in `~/.fieldtheory/sync-all.sh` so new orphan X saves hydrate nightly (not done — needs your call).

## Open questions

- None.

## Working set (files/ids/commands)

- modified: /Users/manik/Github/fieldtheory-cli/src/daily/synthesize.ts
- read: /Users/manik/Github/fieldtheory-cli/src/daily/synthesize.ts
- commands:
  - `date; cd /Users/manik/Github/fieldtheory-cli && node dist/cli.js daily --help 2>&1 | head -40`
  - `mkdir -p /tmp/daily-backup-fmt && cp /Users/manik/.fieldtheory/library/daily/2026-08-16.{md,html,epub} /tmp/daily-backup`
  - `cd /Users/manik/Github/fieldtheory-cli && node dist/cli.js daily --date 2026-08-16 --write --force --ground --epub 2>&1 `
  - `cd /Users/manik/.fieldtheory/library/daily && rg -n -A1 "^- \[" 2026-08-16.md | sed -n '1,40p'`
  - `cd /Users/manik/Github/fieldtheory-cli && npm run build >/dev/null 2>&1 && npm test 2>&1 | tail -5`
  - `cd /Users/manik/Github/fieldtheory-cli && node dist/cli.js daily --date 2026-08-16 --write --force --ground --epub 2>&1 `
  - `cd /Users/manik/.fieldtheory/library/daily && rg -n -A1 "anti-slop|attention-span|conductor does not speak" 2026-08-16.m`
  - `cd /Users/manik/Github/fieldtheory-cli && npm run build >/dev/null 2>&1 && npm test 2>&1 | tail -4 && node dist/cli.js d`
  - `cd /Users/manik/.fieldtheory/library/daily && rg -n -A1 "conductor does not speak\]|anti-slop\]" 2026-08-16.md | head -6`
  - `cd /Users/manik/.fieldtheory/library/daily && rg -n -A3 "^Connects to earlier saves:" 2026-08-16.md | head -8 && open 20`

## Activity log

- 2026-08-18: fixed truncated "Reveal source reminder" text in the digest Recall section. Root cause: `queueReviewCards` stored `cleanText(searchText).slice(0, 360)` — a hard cut that echoed the title back and ended mid-word. Extracted the themed-item summarizer into `src/daily/summary.ts` (`summarizeSavedText(item, maxChars)` + `truncateAtBoundary`: sentence end in the last 40% of the budget wins, else word boundary + `…`); `dailyItemSummary` and new `buildReviewAnswer` both call it. Tests `tests/daily-summary.test.ts` (5); suite 1042/1042. Backfilled the stored cards with `~/snippets/fieldtheory-rebuild-review-answers.mjs --apply` (110/112 rewritten, 2 canonical rows gone; backup `reviews.json.bak-20260818`) and patched the already-written 2026-08-18 md+html reveals, then re-exported the epub. Shipped as `d8d7c63`.

- 2026-08-18: `--epub` is now default in the nightly (`src/sync-all.ts` daily step → `['daily','--write','--epub']`, test updated, suite 1037/1037, `c15c285`). Backfilled 2026-08-18.epub by hand (`ft daily --date 2026-08-18 --epub`, 13 chapters / 38 KB — no LLM re-run, converts the existing md). Re-ran the stalled NotebookLM push with new `~/snippets/fieldtheory-nlm-push-digest.sh` (mirrors the sync-all nlm block, idempotent via the week manifest): 8 remaining YouTube notes pushed, W34 manifest now 11 entries (digest + 10 notes).

- 2026-08-18: nightly sync-all exit=0 (09:00:04 → 10:02:15, ~62m). All 14 steps ✓. Digest 2026-08-18.{md,html}: **synthesis llm / grok**, 7 themes, 74 collected / 69 themed / 5 also-saved / 5 thin_skipped / 12 enriched / 0 carried_over / 0 citations_dropped / 49 undateable_excluded / 3 reviews due. All three 08-17 watch items resolved: no mechanical fallback, per-item summary lines + domain-suffixed "Connects to earlier saves" render correctly, 0 bare tweet-id titles in the digest. Still no epub (sync-all daily step has no `--epub`). NotebookLM: notebook W34, pushed digest + 2 YouTube notes, then the loop stopped mid-upload of `u_k9cwDNPcM.md` after `ConnectError` retries 1/4 and 2/4 — no FAILED line, no further log output, process gone; last 2 notes unpushed.

- 2026-08-18: fixed Raindrop-only X saves rendering as bare tweet ids with no description in the daily digest. Root cause: Raindrop's scraper cannot pass x.com's auth wall, so it stores `title = <tweet id>` and no excerpt; the existing canonical fold only fixes saves whose tweet is also an X bookmark. New `src/raindrop/x-hydrate.ts` (candidate selection, JSONL cache at `~/.fieldtheory/bookmarks/raindrop/x-hydrated.jsonl`, permanent-vs-transient failure caching, flush every 25) + `createTweetFetcher()` extracted from `syncGaps` in `src/graphql-bookmarks.ts` (authenticated TweetResultByRestId → public syndication). `raindropSourceFromRecord(record, hydration?)` now sets title (`@handle: <tweet head>`, 120 chars), authorHandle, text, and ISO-normalized posted date, with `@handle on X` as the un-hydrated fallback. CLI: `ft hydrate-x [--limit --delay --dry-run --browser]` and `ft sync-raindrop --hydrate-x`. Live backfill: 281 candidates of 3675 raindrop X saves (the rest fold into X bookmarks) → 207 fetched, 74 deleted/not_found. Caught a self-inflicted regression on verification: the first cut set a synthetic `@handle on X` source title, which outranks the X source in `buildCanonicalGroup` and hid real tweet text for 3.2k folded rows. Fixed by leaving the source title null for un-hydrated placeholders and applying the handle-only title group-side (`xHandleOnlyTitle`) only when nothing else exists. After rebuild: 7956 X rows, 0 bare-id titles, 41 handle-only (deleted tweets), 5 whose tweet text is only a t.co link (pre-existing). Tests `tests/raindrop-x-hydrate.test.ts` (11) + a canonical fold/orphan test; suite 1037/1037.

- 2026-08-18: daily synthesis fallback chain reworked after the 08-17 mechanical fallback. `FT_DAILY_FALLBACK_ENGINE_2` default droid → grok (`grok-4.5`; droid's model went China-only), chain dedupe now keys on engine+model and seeds the primary's pinned model so an identical attempt never repeats, invoke timeout default 300s → 600s. Chain is now grok-4.6 → grok-4.6 retry → agy → grok-4.5. Re-ran 2026-08-17 with `--force --ground --epub`: synthesis llm/grok, 7 themes, EPUB written (item set shifted 200 → 143 as expected for a UTC-window re-collection; originals backed up in the session scratchpad).

- 2026-08-18: amp oracle review of both changes (`--task review`, run amp-20260818T025441Z-1luhyb) returned 2 findings, both fixed: (1) fallback dedupe did not know the primary model, so `--model grok-4.5` re-ran an identical 600s attempt; (2) `remaining` counted only limit-skipped candidates, so a fully rate-limited run reported "0 queued".

- 2026-08-17: nightly sync-all exit=0 (09:13:35 → 19:47:20, ~10.5h). All 14 steps ✓. Digest written: 2026-08-17.{md,html} — 200 new items (cap), 11 themes, `synthesis: mechanical`, 139 thin_skipped, 22 enriched, 35 carried_over, 50 undateable_excluded, 3 reviews due. Throughline reads "Synthesis was unavailable…"; themes are raw "New from <source>" buckets. synthesis_error: grok 300s timeout → grok retry 300s timeout → agy 300s timeout → droid "model only available hosted in China, requires explicit opt in". Follow-ups: (a) FT_DAILY_TIMEOUT_MS 300s is too tight for a 200-item prompt — bump or trim prompt; (b) droid fallback engine is dead until opt-in/model change; (c) sync-all does not pass `--epub`, so no 2026-08-17.epub; (d) nlm push failed with `[Errno 54] Connection reset by peer`.

- 2026-08-16: swept existing digests instead of re-synthesizing them (user choice: `ft daily --write --force --date` uses a UTC-day window, so it would have changed the item set and themes, not just URLs). `~/snippets/fieldtheory-strip-tracking-params-in-digests.mjs` (dry-run default, `--apply`, `--dir`) rewrote 384 urls across 35 files under `~/.fieldtheory/library/daily`; backup at `<scratchpad>/daily-backup-20260816.tgz`. Gotcha found in preview: round-tripping every URL through the WHATWG parser also percent-encodes unicode (`https://youtu.be/…` → `%E2%80%A6`) inside link *labels* and appends a root slash to bare hosts, so the script only touches URLs matching `[?&](utm_*|fbclid|gclid|mc_cid|mc_eid)=`; also strips trailing sentence punctuation before parsing so it is not folded into the query. HTML files decode `&amp;` before cleaning and re-escape after. Re-exported the 4 EPUBs on disk (08-12/13/15/16) → 0 tracking hits, hrefs intact (213/302/295). Library-wide grep for tracking params in daily md/html: 0.

- 2026-08-16: fixed tracking params leaking into rendered digests. Root cause: `normalizeBookmarkUrl()` only fed `dedupe_key`; `buildCanonicalGroup()` stored the raw `sourceUrl`/`targetUrl` in `canonical_url`, which is what md/html/epub/search render. Added `cleanDisplayUrl()` in src/url-normalize.ts (same casing/default-port/tracking-param rules as the dedupe key, but keeps the fragment — section anchors are meaningful; non-URL input passes through) and applied it in `buildCanonicalGroup`, plus in `src/daily/epub.ts` `inline()` so already-written digests export clean (href arrives XML-escaped, so unescape → clean → re-escape). Tests: +2 url-normalize, +1 canonical-bookmarks-db, +1 daily-epub; suite 1025/1025. Live `ft index` rebuild: dirty `canonical_url` rows 314 → 3 (the 3 left are tracking-redirect wrappers — `tracking.tldrnewsletter.com/CL0/<encoded>` and a Google Calendar event-edit link — where utm lives inside the path, not the query; unwrapping redirect hosts is a separate follow-up). Regenerated 2026-08-16.epub → 0 tracking hits (md still has 21; the md/html on disk are frozen text, so past digests stay dirty until re-run, but their EPUB export is clean). ~10 `link_enrichment` rows keyed by dirty URLs are now orphaned and will re-enrich once.

- 2026-08-16: applied the Kindle review. `src/epub.ts`: CSS now sets zero `color`/`background` (theme-safe; `.reveal` panel → left rule, `.meta` → italic, grays only on borders), body margin dropped, `<!DOCTYPE html>` on every XHTML doc, `landmarks` nav + legacy `<guide>` with start-reading on chapter 2, optional `cover` (stored uncompressed, `properties="cover-image"` + legacy `<meta name="cover">`), `startChapterId` option. New `src/crc32.ts` (shared by ZIP + PNG), `src/png.ts` (8-bit greyscale PNG encoder, ~55 lines), `src/cover.ts` (5x7 bitmap font, vertically centred block: eyebrow / rule / date / title). Daily converter passes date-forward cover; 1000x1600, ~4.5 KB, epub 30→36 KB. Tests: `tests/cover.test.ts` (4) + 3 in `tests/daily-epub.test.ts`; suite 1021/1021. README corrected — USB EPUB side-load to Kindle is unsupported; Send-to-Kindle is the path. Shipped with the EPUB feature as `6d49cfd`.

- 2026-08-16: Kindle-visibility review of the EPUB writer done (fable subagent; inspected src/epub.ts, src/daily/epub.ts, real 2026-08-15.epub). Key facts: EPUB reaches e-ink Kindle only via Send-to-Kindle conversion (USB EPUB side-load unsupported post-2022); Kindle ignores series metadata (`belongs-to-collection`/`calibre:series`) for personal docs — title-with-date is the grouping. Must-fix: (1) no cover → declare `properties="cover-image"` + legacy `<meta name="cover">`, raster PNG (zero-dep plan: ~80-line PNG encoder reusing node:zlib+CRC32 already in epub.ts + 8x8 bitmap font, ~250-350 lines total; SVG covers unsafe on Kindle); (2) dark-mode CSS: `.reveal` `#f2f2f2` background and `#555` fixed colors unreadable in night themes → border instead of background, drop fixed colors. Worth-doing: remove `body margin 0 5%`, add landmarks nav + `<guide>` (start-reading at Recall first), add `<!DOCTYPE html>`. Fine as-is: dcterms:modified (required, present), nav not in spine (no `hidden` needed), toc.ncx harmless, links stay inline (e-ink links are dead ends; markdown library is the action surface; popup footnotes wrong tool), ZIP layer verified correct.

- 2026-08-15: added Kindle/e-reader EPUB export for the daily digest. New `src/epub.ts` (dependency-free EPUB 3 + ZIP writer over node:zlib, deterministic output, mimetype stored first, nav.xhtml + toc.ncx) and `src/daily/epub.ts` (digest markdown → reading-optimized chapters; drops grade lines/ids/System details, unwraps `<details>` into reveal boxes, degrades non-http links to text). `--epub` on `ft daily`: with `--write` it writes beside the md/html; without `--write` it converts an existing digest (`--date`, else newest) so past days export with no LLM run. Added `writeBinary` to `src/fs.ts`. Tests `tests/daily-epub.test.ts` (7); suite 1014/1014. Live: 2026-08-15 → 12 chapters/30KB, 08-12 and 08-13 → 13 chapters; all XHTML/OPF/NCX parse; chapter render checked in a browser. Shipped as `6d49cfd` (with the 08-16 Kindle fixes folded in).

- 2026-08-15: fixed the 08-14/15 run's failure classes. New `src/net-retry.ts` (`isTransientNetworkError` + `retryTransient`, 3 attempts, 1s→3s backoff) wired into: RSS (`rss/sync.ts` per-feed retry, `rss/client.ts` timeout 20s→30s), YouTube (`youtube/fetch.ts` fetchText + `youtube/playlist.ts` get 30s AbortSignal.timeout + retry), and `cli.ts` sync-youtube (per-video retry, attempts 2, so one dropped socket no longer replays all 8 videos). `x-list-summary` LLM timeout 300s→600s (FT_DAILY_TIMEOUT_MS still overrides). `~/.fieldtheory/sync-all.sh` gained a PID-file single-instance guard (stale-pid safe, trap-cleaned). Tests: `tests/net-retry.test.ts` (5) + 3 RSS retry tests; suite 1007/1007. Live `ft sync-rss` → 98/98 ok. Uncommitted.

- 2026-08-15: grok engine default bumped `grok-4.5` → `grok-4.6` (live default per ~/.grok/models_cache.json, 500k ctx). Changed `src/engine.ts` GROK_DEFAULT_MODEL, `src/cli.ts` --model help text, README, tests (engine/daily/daily-index-html), and `~/.fieldtheory/sync-all.sh` FT_DAILY_MODEL default. Build ✓, 999/999 ✓, live `grok -p --model grok-4.6` ✓. Uncommitted.

- 2026-08-15: checked today's run. Latest sync-all started 08-14 09:12:46, exit=0 at 08-15 10:44:49 (~25.5h wall). No separate 08-15 09:00 start — prior run still active, so daily launch effectively skipped/overlapped. Digest `library/daily/2026-08-15.md` written (77 new items, 7 themes, synthesis=llm/grok, 3 reviews due). Non-fatal failures: 3× `Error: fetch failed`; x-list-summary `llm failed: grok timed out after 300s` (mechanical fallback, wrote x-list/2026-08-14.md); RSS 93/98 ok (5 aborted: crawshaw, Evan Hahn, Geoffrey Huntley, Geoffrey Litt, Marc Brooker); YouTube 5 "failed: terminated" across passes, final pass 8/8 ok. NotebookLM push OK.

- 2026-08-11: daily sync-all ran 09:06:10 → 23:28:47 (exit=1). All steps ✓ except `ft x-list 1979812953135497678 --since-hours 24` (failed after 3 attempts). x-list-summary still "succeeded" off stale `1979812953135497678-latest.json` (mtime 10 Aug 14:07), so `library/daily/x-list/2026-08-11.md` is byte-identical to 08-10 except the date — silent stale-data bug worth fixing (summary should skip/flag when latest.json is older than the target date).
- [2026-08-16 20:28] check the /Users/manik/.fieldtheory/library/daily format and content, while the contents are — modified: 3, read: 6, commands: 26, errors: 2
- [2026-08-16 20:42] let's run for today to check — modified: 1, read: 1, commands: 10, errors: 0

## Project learnings

- No browser MCP tool loaded in some sessions; drive local pages with `node ~/snippets/browser-cdp-probe.mjs <url> --eval '<js>' --shot out.png` (raw CDP over Node's WebSocket + the playwright cache's chrome-headless-shell).
- Canonical searchText often begins with the display title TWICE (title field + source text both carry it, e.g. github-stars fullName), so title-prefix stripping must loop; and a summary that startsWith(title) can be legitimate content, not an echo.

