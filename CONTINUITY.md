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

- Tracking params now stripped from `canonical_url` at index time (was dedupe-key-only), plus a defensive strip in the markdown→EPUB link renderer.

### Next

- User tests `~/.fieldtheory/library/daily/2026-08-16.epub` in Apple Books.
- Kindle review findings applied (see 2026-08-16 entries). Remaining optional: append visible domain to link labels for e-ink orientation (one-line change, not yet decided).
- Merge/PR the branch, then watch the next nightly run for RSS 98/98, zero YouTube `terminated`, and `synthesis: llm` on the x-list summary.
- Optional, deferred by decision: emailing the EPUB to a Kindle address (SMTP) — file-only for now.

## Open questions

- None.

## Working set (files/ids/commands)

- `src/{url-normalize,canonical-bookmarks-db,cli}.ts`, `src/daily/{enrich,html,synthesize}.ts`, `tests/{canonical-bookmarks-db,daily}.test.ts`

## Activity log

- 2026-08-16: fixed tracking params leaking into rendered digests. Root cause: `normalizeBookmarkUrl()` only fed `dedupe_key`; `buildCanonicalGroup()` stored the raw `sourceUrl`/`targetUrl` in `canonical_url`, which is what md/html/epub/search render. Added `cleanDisplayUrl()` in src/url-normalize.ts (same casing/default-port/tracking-param rules as the dedupe key, but keeps the fragment — section anchors are meaningful; non-URL input passes through) and applied it in `buildCanonicalGroup`, plus in `src/daily/epub.ts` `inline()` so already-written digests export clean (href arrives XML-escaped, so unescape → clean → re-escape). Tests: +2 url-normalize, +1 canonical-bookmarks-db, +1 daily-epub; suite 1025/1025. Live `ft index` rebuild: dirty `canonical_url` rows 314 → 3 (the 3 left are tracking-redirect wrappers — `tracking.tldrnewsletter.com/CL0/<encoded>` and a Google Calendar event-edit link — where utm lives inside the path, not the query; unwrapping redirect hosts is a separate follow-up). Regenerated 2026-08-16.epub → 0 tracking hits (md still has 21; the md/html on disk are frozen text, so past digests stay dirty until re-run, but their EPUB export is clean). ~10 `link_enrichment` rows keyed by dirty URLs are now orphaned and will re-enrich once.

- 2026-08-16: applied the Kindle review. `src/epub.ts`: CSS now sets zero `color`/`background` (theme-safe; `.reveal` panel → left rule, `.meta` → italic, grays only on borders), body margin dropped, `<!DOCTYPE html>` on every XHTML doc, `landmarks` nav + legacy `<guide>` with start-reading on chapter 2, optional `cover` (stored uncompressed, `properties="cover-image"` + legacy `<meta name="cover">`), `startChapterId` option. New `src/crc32.ts` (shared by ZIP + PNG), `src/png.ts` (8-bit greyscale PNG encoder, ~55 lines), `src/cover.ts` (5x7 bitmap font, vertically centred block: eyebrow / rule / date / title). Daily converter passes date-forward cover; 1000x1600, ~4.5 KB, epub 30→36 KB. Tests: `tests/cover.test.ts` (4) + 3 in `tests/daily-epub.test.ts`; suite 1021/1021. README corrected — USB EPUB side-load to Kindle is unsupported; Send-to-Kindle is the path. Shipped with the EPUB feature as `6d49cfd`.

- 2026-08-16: Kindle-visibility review of the EPUB writer done (fable subagent; inspected src/epub.ts, src/daily/epub.ts, real 2026-08-15.epub). Key facts: EPUB reaches e-ink Kindle only via Send-to-Kindle conversion (USB EPUB side-load unsupported post-2022); Kindle ignores series metadata (`belongs-to-collection`/`calibre:series`) for personal docs — title-with-date is the grouping. Must-fix: (1) no cover → declare `properties="cover-image"` + legacy `<meta name="cover">`, raster PNG (zero-dep plan: ~80-line PNG encoder reusing node:zlib+CRC32 already in epub.ts + 8x8 bitmap font, ~250-350 lines total; SVG covers unsafe on Kindle); (2) dark-mode CSS: `.reveal` `#f2f2f2` background and `#555` fixed colors unreadable in night themes → border instead of background, drop fixed colors. Worth-doing: remove `body margin 0 5%`, add landmarks nav + `<guide>` (start-reading at Recall first), add `<!DOCTYPE html>`. Fine as-is: dcterms:modified (required, present), nav not in spine (no `hidden` needed), toc.ncx harmless, links stay inline (e-ink links are dead ends; markdown library is the action surface; popup footnotes wrong tool), ZIP layer verified correct.

- 2026-08-15: added Kindle/e-reader EPUB export for the daily digest. New `src/epub.ts` (dependency-free EPUB 3 + ZIP writer over node:zlib, deterministic output, mimetype stored first, nav.xhtml + toc.ncx) and `src/daily/epub.ts` (digest markdown → reading-optimized chapters; drops grade lines/ids/System details, unwraps `<details>` into reveal boxes, degrades non-http links to text). `--epub` on `ft daily`: with `--write` it writes beside the md/html; without `--write` it converts an existing digest (`--date`, else newest) so past days export with no LLM run. Added `writeBinary` to `src/fs.ts`. Tests `tests/daily-epub.test.ts` (7); suite 1014/1014. Live: 2026-08-15 → 12 chapters/30KB, 08-12 and 08-13 → 13 chapters; all XHTML/OPF/NCX parse; chapter render checked in a browser. Shipped as `6d49cfd` (with the 08-16 Kindle fixes folded in).

- 2026-08-15: fixed the 08-14/15 run's failure classes. New `src/net-retry.ts` (`isTransientNetworkError` + `retryTransient`, 3 attempts, 1s→3s backoff) wired into: RSS (`rss/sync.ts` per-feed retry, `rss/client.ts` timeout 20s→30s), YouTube (`youtube/fetch.ts` fetchText + `youtube/playlist.ts` get 30s AbortSignal.timeout + retry), and `cli.ts` sync-youtube (per-video retry, attempts 2, so one dropped socket no longer replays all 8 videos). `x-list-summary` LLM timeout 300s→600s (FT_DAILY_TIMEOUT_MS still overrides). `~/.fieldtheory/sync-all.sh` gained a PID-file single-instance guard (stale-pid safe, trap-cleaned). Tests: `tests/net-retry.test.ts` (5) + 3 RSS retry tests; suite 1007/1007. Live `ft sync-rss` → 98/98 ok. Uncommitted.

- 2026-08-15: grok engine default bumped `grok-4.5` → `grok-4.6` (live default per ~/.grok/models_cache.json, 500k ctx). Changed `src/engine.ts` GROK_DEFAULT_MODEL, `src/cli.ts` --model help text, README, tests (engine/daily/daily-index-html), and `~/.fieldtheory/sync-all.sh` FT_DAILY_MODEL default. Build ✓, 999/999 ✓, live `grok -p --model grok-4.6` ✓. Uncommitted.

- 2026-08-15: checked today's run. Latest sync-all started 08-14 09:12:46, exit=0 at 08-15 10:44:49 (~25.5h wall). No separate 08-15 09:00 start — prior run still active, so daily launch effectively skipped/overlapped. Digest `library/daily/2026-08-15.md` written (77 new items, 7 themes, synthesis=llm/grok, 3 reviews due). Non-fatal failures: 3× `Error: fetch failed`; x-list-summary `llm failed: grok timed out after 300s` (mechanical fallback, wrote x-list/2026-08-14.md); RSS 93/98 ok (5 aborted: crawshaw, Evan Hahn, Geoffrey Huntley, Geoffrey Litt, Marc Brooker); YouTube 5 "failed: terminated" across passes, final pass 8/8 ok. NotebookLM push OK.

- 2026-08-11: daily sync-all ran 09:06:10 → 23:28:47 (exit=1). All steps ✓ except `ft x-list 1979812953135497678 --since-hours 24` (failed after 3 attempts). x-list-summary still "succeeded" off stale `1979812953135497678-latest.json` (mtime 10 Aug 14:07), so `library/daily/x-list/2026-08-11.md` is byte-identical to 08-10 except the date — silent stale-data bug worth fixing (summary should skip/flag when latest.json is older than the target date).

## Project learnings

- No browser MCP tool loaded in some sessions; drive local pages with `node ~/snippets/browser-cdp-probe.mjs <url> --eval '<js>' --shot out.png` (raw CDP over Node's WebSocket + the playwright cache's chrome-headless-shell).
