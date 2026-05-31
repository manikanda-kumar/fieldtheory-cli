LATEST SESSION (2026-05-31) — Raindrop.io replaces browser bookmark sync + review fixes + canonical markdown export preview:
- **Replaced local browser bookmark sync with Raindrop.io cloud sync.**
  - New module `src/raindrop/` (`types.ts`, `paths.ts`, `client.ts`, `sync.ts`) — API client with Bearer auth, pagination, 429 retry, 401 fast-fail.
  - `ft sync-raindrop` command with `--rebuild`, `--full`, `--collections`, `--classify`, `--dry-run`, `--perpage`, `--limit`.
  - `ft sync-browser` deprecated — prints notice directing to `sync-raindrop` and exits 1.
  - Removed `src/browser-bookmarks.ts`, `tests/browser-bookmarks.test.ts`, and all browser path helpers from `src/paths.ts`.
  - Raindrop JSONL cache at `~/.fieldtheory/bookmarks/raindrop/bookmarks.jsonl`.
  - Canonical DB integration: `raindropSourceFromRecord()` in `src/canonical-bookmarks-db.ts`; `rebuildCanonicalIndex()` reads Raindrop JSONL alongside X and YouTube.
  - Deduplication works automatically via `dedupeKeyForUrl()` — Raindrop URLs merge with X/YouTube equivalents.
  - Malformed URL resilience: `raindropSourceFromRecord()` catches parse errors and returns `null`, filtered before insertion.
  - Collection nesting: `buildCollectionMap` resolves full breadcrumb paths with cycle guard (`visited` set).
  - Token env: client checks both `RAINDROP_TOKEN` and `RAINDROP_TEST_TOKEN`.
- **Review fixes applied** (from `docs/review_raindrop_integration.md`):
  - Bug: `collectionName` extracted root ancestor `[0]` → fixed to `.at(-1)` (leaf name).
  - Bug: resume pagination broken (always restarted page 0) → writes incremental state after each page; uses `completed` boolean flag in `RaindropBackfillState` to distinguish crash recovery from fresh re-fetch.
  - Bug: `important: false` silently dropped → changed `||` to `??`.
  - Bug: modified count always matched total → `mergeRaindropRecord` now tracks material changes (title, excerpt, note, tags, highlights, updatedAt) and only bumps count when true.
  - Bug: `--unified` help text still said "browser" → updated to "Search/List unified X, Raindrop, and YouTube bookmarks".
  - Edge: no max-page guard → added `MAX_PAGES = 10_000` with warning.
  - Edge: circular parent collections → added `visited` Set to `resolvePath`.
  - Enhancement: `--limit <n>` option added for testing large accounts (dry-run of 100 bookmarks / 7 collections succeeded live).
- **Canonical markdown export** (temporary preview stage):
  - Added `exportCanonicalBookmarks()` to `src/md-export.ts` — exports from canonical DB instead of legacy X-only table.
  - Added `getCanonicalBookmarkSources()` to `src/canonical-bookmarks-db.ts` — queries `bookmark_sources` rows by `canonical_id`.
  - Raindrop-specific frontmatter: `source: raindrop`, `raindrop_id`, `collection`, `tags`, `starred`, `highlights_count`, `category`, `domain`, `saved_at`.
  - Raindrop-specific body sections: excerpt blockquote, `## Note`, `## Highlights` with color badges, `## Links`, `## Related` wikilinks.
  - Accepts configurable `outputDir` for temporary preview before writing to real library.
- **Tests updated and passing:**
  - `tests/canonical-bookmarks-db.test.ts` — all browser bookmark tests converted to Raindrop equivalents.
  - `tests/cli.test.ts` — sync-browser deprecation tests + sync-raindrop option tests.
  - `tests/paths.test.ts` — browser path tests replaced with Raindrop path tests.
  - Build passes (`npm run build`), all 663 tests pass (`npm run test`).
- **Docs:**
  - Plan created: `docs/plans/2026-05-31-raindrop-bookmarks-integration.md`.
  - Review doc created: `docs/review_raindrop_integration.md`.

LATEST SESSION (2026-05-28) — index reconcile + rich-notes prompt verified live:
- Bug: `index.html` showed only 58/256 library videos after latest playlist sync — state.json had 49 entries (only current sync), 207 older notes orphaned. Root cause: state load/save only carries forward what's in `state.json`; nothing reseeds from disk after wipe.
- Fix: added `reconcileYoutubeStateFromLibrary()` in `src/youtube/state.ts` — walks `youtubeLibraryDir()/**/*.md`, parses frontmatter + H1 + topics, inserts entries whose videoId is missing or has no `notesPath`. Called from `writeYoutubeIndexFromState()` before reading state. Idempotent. Recovery run: +210 entries, total 259 videos, index now 256 cards.
- Bug: `1VqKUrxR2C8.md` (81-min Dax Raad interview, Pragmatic Engineer) had 41 lines / 5 chapters capped at 02:00. Cause: old generation under tight prompt + 24K char budget.
- Fix verified live: uncommitted notes.ts diff (budget 24K→48K, duration-aware target chapter/keypoint counts, "cover whole video" + "rich notes from actual transcript" prompt, denser chunk picker `max(12, budget/350)`) regenerated to 103 lines / 38 chapters spanning full 4861s, named tools (Antithesis, Turbopuffer, SST, OpenNext, WorkOS) + numbers (650k activations, 8M MAU, multi-million ARR).
- Uncommitted now: `CONTINUITY.md`, `src/cli.ts` (`--engine none`, playlist sync records last seen playlist but lets `processVideo` decide skips), `src/youtube/notes.ts` (richer prompt), `src/youtube/state.ts` (`markPlaylistSynced` + reconcile), `src/youtube/index-html.ts` (call reconcile), tests, plus pre-existing `docs/reviews/`, `review.md`, `.claude/settings.local.json`. Current verification: `npm run build` passes; `npm test` passes (674/674).

PRIOR SESSION (2026-05-25) — slide-embed + boilerplate guard + recovery close-out:
- Slides now embedded inline as clickable thumbnails under their chapter bucket (no detached `## Slides` list, no bullet prefix). `renderNotesMarkdown(videoId, meta, notes, slides, syncedAt)` in `src/youtube/notes.ts`; `SlideImage` type. Boilerplate guard `isYoutubeBoilerplate` in `src/youtube/fetch.ts` → `NoTranscriptError` so HTML/oEmbed fallback can't write a fake-transcript stub over good notes. Committed+pushed `88c507e` on `main`. 671/671 tests pass.
- 98-video codex/gpt-5.5/low rerun: 64 improved, 30 clobbered (mid-run yt-dlp meta failures pre-guard → "- YouTube" + boilerplate stubs). Recovery rerun (medium effort): **27/30 recovered**. Remaining 3 (`gkGudLbTfHQ`, `mZqh7emiz9Q`, `QEPNktux_k8`) are now **Private videos** on YouTube — unrecoverable. Marked `skipped-no-transcript` (error "Private video"), stub notes deleted, dropped from `index.html`.
- Embed batch (`/tmp/yt-embed-batch.ts`) confirmed 0 detached `## Slides` library-wide; recovered notes already written in inline format. Library sweep: 0 boilerplate, 0 "- YouTube", 0 detached slides.
- DONE. No code pending. Only uncommitted: CONTINUITY.md (this ledger), `.claude/settings.local.json`, `docs/reviews/`, `review.md` (kept uncommitted per instruction).

PRIOR SESSION (2026-05-23) — YouTube transcript-extraction improvements + retry:
- Implemented from `/Users/manik/.agent/diagrams/youtube-transcript-architecture.html`: P0 ladder reorder (cookie/impersonation yt-dlp captions lead, `--write-subs`+auto, timedtext demoted, summarize last), P1 semantic chunking (`chunkTextIntoSegments` in `src/youtube/fetch.ts`, kills single-segment cram), P3 severity split (`validateNoteQuality` returns `{message,severity}`; only thin transcript forces `partial`), P4 429 backoff (`retryOnRateLimit` wraps all yt-dlp calls) + CLI `--request-delay-ms` (default 1500).
- Committed `17f8883`; remote had diverged with parallel `4b85551` (video-pipeline rework: summarize-bridge arg overhaul `--youtube auto --format md --markdown-mode llm --timeout` + slides.json reconciliation + stale-artifact clearing). Merged into `f2301e4`, resolved 4 files as unions, pushed. 669/669 tests pass.
- RETRY RESULT: reran all 71 IDs (`docs/retry-video-ids.txt`, `--overview slides --cookies-from-browser chrome --impersonate chrome`). BEFORE: 58 partial / 13 done. AFTER: **70 done (zero warnings) / 1 partial**. Genuine acquisition win (not relabel): e.g. `_efJ8baMSDw` 42-min video now full 8.5KB note, 23 chapters, no warnings. Only `YD7FMnJYA-0` (~50min) stays partial = genuinely caption-thin → the P2 (local ASR) target.
- SECOND RERUN: 98 non-retry `done` videos flagged thin (chapters<=3 or <200 chars/min vs duration; worst `fn-59Kb8RbI` 7.7hr video @ 6 cpm). IDs in `/tmp/yt-p0-candidates.txt`, baseline metrics in `/tmp/yt-p0-baseline.json`. Rerunning with `--engine codex --model gpt-5.5 --effort low --overview slides --cookies-from-browser chrome --impersonate chrome`, log `/tmp/yt-p0.log`. (First default-engine attempt killed; relaunched per user with codex/gpt-5.5/low.)
- DEFERRED: P2 local ASR (whisper from yt-dlp audio) — would recover the last caption-thin stragglers. P5 partials dashboard.
- NOTE: this ledger was reverted to an older version by a stash/merge during the session; sections below are stale (browser-bookmarks era).

Goal (incl. success criteria):
- ACTIVE: Add `ft sync-youtube --playlist <url|id>` — turn a public YouTube watch-later playlist into local artifacts: structured text notes (transcript→LLM) for every new video, written to the markdown library and indexed in the existing SQLite FTS DB; plus an optional local AI overview — `--overview audio` (condensed ~12-min script→TTS) or `--overview video` (slide-gated: only slide-heavy videos get a script→TTS→ffmpeg slideshow mp4, with audio degradation when assembly fails). Idempotent reruns. LLM via OpenRouter (OpenAI primary, Gemini fallback); TTS via real OpenAI API (OpenRouter has no TTS endpoint), with local `say`/`piper` options when installed. Reuse `bookmark_sources`/`canonical_bookmarks` (source `youtube`), no schema change. Optional external bins: `summarize` (steipete/summarize), `yt-dlp`, `ffmpeg` — runtime-detected with fallbacks where available. Implemented by sub-agents with one consolidated Oracle review at the end.
- DONE (prior): browser bookmark sync (Chrome/Vivaldi) with hybrid raw caches + canonical dedupe index; `ft sync` media opt-in (`--media`); docs under `docs/specs/`+`docs/plans/`; remote → `manikanda-kumar/fieldtheory-cli`. All committed on `main` through `50e19c9`.

Constraints/Assumptions:
- Existing X bookmark model is tweet-centric: `BookmarkRecord` requires `tweetId`, and the current SQLite `bookmarks` table requires `tweet_id TEXT NOT NULL`.
- Raindrop bookmarks flow through a separate JSONL cache (`raindrop/bookmarks.jsonl`) and feed into the canonical `bookmark_sources` table with `source = 'raindrop'`.
- Local file-based browser sync (`sync-browser`) has been deprecated and removed in favor of Raindrop cloud sync.
- First implementation should expose unified behavior explicitly, e.g. `--unified`, before changing existing command defaults.
- Remote `origin` has been updated to `https://github.com/manikanda-kumar/fieldtheory-cli`.

Key decisions:
- Use hybrid storage: raw provider-specific JSONL caches (X, Raindrop), plus additive canonical tables in the existing `bookmarks.db`.
- Keep existing X raw cache and X `bookmarks` SQL table intact.
- Add canonical SQL tables: `bookmark_sources`, `canonical_bookmarks`, and a canonical FTS table.
- Deduplicate with a conservative `dedupe_key`:
  - Raindrop/browser bookmark: `url:<normalized bookmark URL>`
  - X bookmark with exactly one clear external link: `url:<normalized external link>`
  - X bookmark with zero or multiple ambiguous external links: `x:<tweetId>`
- URL normalization v1: lowercase scheme/host, remove fragments/default ports, strip known tracking params, preserve meaningful query params, no network canonicalization.
- Classify canonical bookmarks, not raw source rows, using merged evidence from title, folder path, URL/domain, X tweet text, enriched X article text, and Raindrop excerpt/note/highlights when available.
- Browser bookmarks now synced exclusively via Raindrop.io API (`ft sync-raindrop`); local Chromium file parsing (`sync-browser`) has been removed.
- Add explicit browser sync command first: `ft sync-browser --browser chrome|vivaldi|safari` (Safari path currently reserved and fails clearly).
- Browser bookmark sync does not fetch media.
- Change X `ft sync` media behavior to no media by default, with opt-in `--media`.
- Add repo-level AGENTS.md instructions to keep future docs under `docs/specs/` and `docs/plans/`.

State:
- Raindrop integration implemented and all review fixes applied.
- Build passes (`npm run build`), all 663 tests pass (`npm run test`).
- Live dry-run smoke test verified: 100 bookmarks / 7 collections via Raindrop API.
- Design spec: `docs/plans/2026-05-31-raindrop-bookmarks-integration.md`.
- Review doc: `docs/review_raindrop_integration.md`.
- Browser bookmark sync fully removed (no references in `src/` or `tests/`).
- Current remote verified as `origin https://github.com/manikanda-kumar/fieldtheory-cli` for fetch and push.
- Uncommitted: `CONTINUITY.md` (this ledger), plus pre-existing `docs/reviews/`, `review.md`, `.claude/settings.local.json`.

Done:
- Explored current repo structure and relevant files:
  - `src/types.ts`
  - `src/bookmarks-db.ts`
  - `src/bookmark-classify.ts`
  - `src/browsers.ts`
  - `src/paths.ts`
  - `src/cli.ts`
  - `README.md`
- Consulted Oracle on the hybrid browser bookmark architecture.
- Oracle recommended keeping raw browser caches separate and adding a provider-neutral canonical index rather than reshaping the X-centric model.
- Wrote design spec: `docs/specs/2026-05-10-browser-bookmarks-design.md`.
- Wrote implementation plan with task breakdown and DONE verification checklist: `docs/plans/2026-05-10-browser-bookmarks-unified-index.md`.
- Verified docs before committing:
  - Both docs existed.
  - Placeholder scan found no unfinished placeholder markers.
  - `git diff --check` reported no whitespace errors.
- Committed planning docs as `98a0320 docs: plan browser bookmark sync`.
- Moved docs out of the old workflow-named docs subtree into generic folders:
  - `docs/specs/2026-05-10-browser-bookmarks-design.md`
  - `docs/plans/2026-05-10-browser-bookmarks-unified-index.md`
- Added `AGENTS.md` with documentation location rules.
- Verified generic docs layout:
  - docs tree contains `docs/specs` and `docs/plans`.
  - no workflow-named documentation path references remain.
  - `git diff --check` reported no whitespace errors.
- Committed generic docs convention as `7ce567f docs: use generic planning folders`.
- Updated git remote origin from `https://github.com/afar1/fieldtheory-cli` to `https://github.com/manikanda-kumar/fieldtheory-cli` and verified fetch/push URLs.
- Implemented URL normalization and dedupe keys:
  - `normalizeBookmarkUrl`
  - `dedupeKeyForUrl`
  - `dedupeKeyForXBookmark`
- Added URL normalization tests covering default ports/fragments, tracking params, URL key prefixing, single external X links, ambiguous external links, and X/Twitter/t.co filtering.
- Reviewed Task 1 with two sub-agents:
  - Spec reviewer approved.
  - Code quality reviewer approved.
- Committed Task 1 as `fa2d995 feat: add bookmark URL dedupe keys`.
- Implemented browser bookmark cache path helpers with path segment validation:
  - `browserBookmarksDir`
  - `browserBookmarksCachePath`
  - `browserBookmarksMetaPath`
- Added Vivaldi to the browser registry.
- Added tests for Vivaldi lookup/list behavior, browser bookmark paths under `FT_DATA_DIR`, and traversal rejection.
- Reviewed Task 2 with sub-agents:
  - Spec reviewer approved.
  - Code quality reviewer requested traversal validation.
  - Code quality re-review approved after the fix.
- Committed Task 2 as `bf3b930 feat: add browser bookmark cache paths`.
- Implemented Chromium bookmark parsing and browser cache sync orchestration:
  - `BrowserBookmarkProvider`
  - `BrowserBookmarkRecord`
  - `chromiumWebkitTimeToIso`
  - `parseChromiumBookmarks`
  - `syncBrowserBookmarks`
- Added tests for Chromium timestamp conversion, recursive folder parsing, cache/metadata writes, and clear Safari unsupported failure.
- Reviewed Task 3 with sub-agents:
  - Spec reviewer approved.
  - Code quality reviewer requested safe temp filename and portable path assertion.
  - Code quality re-review approved after the fix.
- Committed Task 3 as `25db8b6 feat: parse browser bookmarks`.
- Implemented canonical bookmark schema and rebuild/search:
  - `bookmark_sources`
  - `canonical_bookmarks`
  - `canonical_bookmarks_fts`
  - `rebuildCanonicalIndex`
  - `searchCanonicalBookmarks`
- Added canonical tests for X/browser URL dedupe, multiple-link non-dedupe, rebuild metadata preservation, and FTS punctuation sanitization.
- Reviewed Task 4 with sub-agents:
  - Spec reviewer approved.
  - Code quality reviewer requested metadata preservation and FTS query sanitization.
  - Code quality re-review approved after the fix.
- Committed Task 4 as `4d227ea feat: build canonical bookmark index`.
- Added provider-neutral regex classification:
  - `ClassifiableBookmarkInput`
  - `classifyBookmarkInput`
  - existing `classifyBookmark` delegates to the neutral classifier.
- Added canonical classification/listing:
  - `classifyCanonicalBookmarks`
  - `listCanonicalBookmarks`
- Added tests for browser-only GitHub canonical classification and older canonical table migration for classification columns.
- Reviewed Task 5 with sub-agents:
  - Spec reviewer approved.
  - Code quality reviewer requested canonical column migrations and statement cleanup.
  - Code quality re-review approved after the fix.
- Committed Task 5 as `a0a9418 feat: classify canonical bookmarks`.
- Added browser sync orchestration and CLI:
  - `SyncBrowserBookmarksOptions`
  - `syncBrowserBookmarks(..., rebuildCanonical: true)`
  - `ft sync-browser --browser chrome|vivaldi|safari --profile <name> --bookmarks-file <path>`
- `--all` and `--all-profiles` currently fail clearly as unsupported first-cut behavior.
- Added browser sync test proving raw cache write plus canonical rebuild/search.
- Reviewed Task 6 with sub-agents:
  - Spec reviewer approved.
  - Code quality reviewer approved.

Now:
- Implemented the YouTube playlist → notes/overviews plan through the v1 CLI surface:
  - `ft sync-youtube --playlist <url-or-id>` with `--overview none|audio|video`, `--limit`, `--force`, `--dry-run`, `--model`, `--target-minutes`, `--tts`, and `--slide-confidence` flags.
  - New OpenRouter and TTS clients under `src/llm/`.
  - New YouTube modules under `src/youtube/` for state, playlist resolution, fetching, summarize bridge, notes, script, slide gate, overview orchestration, and ffmpeg assembly.
  - YouTube videos are indexed into the canonical SQLite index as `source='youtube'`.
  - Docs added in README and `docs/specs/2026-05-12-youtube-overviews-design.md`.

Next:
- Markdown export review: user requested temporary preview in a tmp directory before approving Raindrop-specific frontmatter/body output.
- Pending: progress bar during `sync-raindrop` for large accounts (current run silently hangs for 400+ API calls).
- Optional: enhance `bookmark-classify.ts` with Raindrop signals (`important`, `type`, `tags`)

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether Gemini TTS should be implemented or kept out of the public `--tts` surface.
- UNCONFIRMED: whether unified search should become the default after the explicit `--unified` rollout proves stable.
- UNCONFIRMED: whether Raindrop markdown export frontmatter/body format should be approved after temp preview.
- UNCONFIRMED: whether progress bar/spinner should be added to `sync-raindrop` for large accounts.
- UNCONFIRMED: whether `--collections` cache scoping should be implemented (isolating per-collection sync from global "All" collection).

Working set (files/ids/commands):
- Docs: `docs/plans/2026-05-31-raindrop-bookmarks-integration.md`, `docs/review_raindrop_integration.md`, `AGENTS.md`, `CONTINUITY.md`.
- Current implementation files: `src/raindrop/types.ts`, `src/raindrop/paths.ts`, `src/raindrop/client.ts`, `src/raindrop/sync.ts`, `src/canonical-bookmarks-db.ts`, `src/md-export.ts`, `src/cli.ts`, `src/paths.ts`.
- Tests: `tests/canonical-bookmarks-db.test.ts`, `tests/cli.test.ts`, `tests/paths.test.ts`.
- Build passes: `npm run build`.
- All tests pass: `npm run test` (663 pass, 0 fail).
- Smoke test verified: `npm run dev -- sync-raindrop --dry-run --limit 100` → 100 bookmarks / 7 collections.
- Remote: `origin https://github.com/manikanda-kumar/fieldtheory-cli`.
- Useful commands: `npm run build`, `npm run test`, `npm run dev -- sync-raindrop --help`, `npm run dev -- search --unified <query>`.
