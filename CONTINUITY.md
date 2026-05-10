Goal (incl. success criteria):
- Add browser bookmark sync support for Safari, Chrome, and Vivaldi using a hybrid architecture: separate raw browser caches plus a unified deduped canonical search/classification index.
- Preserve existing X/Twitter bookmark flows while enabling URL-level dedupe between X-linked resources and browser bookmarks.
- Make sync media fetching opt-in by default: `ft sync` should not fetch media unless `--media` is passed; `ft fetch-media` remains explicit backfill.
- Keep project documentation in generic folders: specs under `docs/specs/`, plans under `docs/plans/`, no workflow/tool/skill names in doc folder names.

Constraints/Assumptions:
- Existing X bookmark model is tweet-centric: `BookmarkRecord` requires `tweetId`, and the current SQLite `bookmarks` table requires `tweet_id TEXT NOT NULL`.
- Do not merge browser bookmark raw records into the existing X `BookmarkRecord` cache or `bookmarks` table.
- Browser bookmark sync should be additive and should not destabilize GraphQL sync, OAuth sync, gap fill, X folders, existing search/list/show behavior, media fetching, or markdown/wiki exports.
- First implementation should expose unified behavior explicitly, e.g. `--unified`, before changing existing command defaults.
- Safari support is macOS-only and should use a dedicated extractor rather than the existing cookie-oriented browser registry.
- Chrome/Vivaldi bookmark extraction should read Chromium `Bookmarks` JSON files by copying to temp first to avoid partial live-file reads.
- Remote `origin` has been updated to `https://github.com/manikanda-kumar/fieldtheory-cli`.

Key decisions:
- Use hybrid storage: raw provider-specific browser JSONL caches, plus additive canonical tables in the existing `bookmarks.db`.
- Keep existing X raw cache and X `bookmarks` SQL table intact.
- Add canonical SQL tables: `bookmark_sources`, `canonical_bookmarks`, and a canonical FTS table.
- Deduplicate with a conservative `dedupe_key`:
  - Browser bookmark: `url:<normalized browser bookmark URL>`
  - X bookmark with exactly one clear external link: `url:<normalized external link>`
  - X bookmark with zero or multiple ambiguous external links: `x:<tweetId>`
- URL normalization v1: lowercase scheme/host, remove fragments/default ports, strip known tracking params, preserve meaningful query params, no network canonicalization.
- Classify canonical bookmarks, not raw source rows, using merged evidence from title, folder path, URL/domain, X tweet text, and enriched X article text when available.
- Add explicit browser sync command first: `ft sync-browser --browser chrome|vivaldi|safari`.
- Browser bookmark sync does not fetch media.
- Change X `ft sync` media behavior to no media by default, with opt-in `--media`.
- Add repo-level AGENTS.md instructions to keep future docs under `docs/specs/` and `docs/plans/`.

State:
- Task 1 is committed as `fa2d995 feat: add bookmark URL dedupe keys`.
- Task 2 implementation is present but not committed:
  - `src/browsers.ts`
  - `src/paths.ts`
  - `tests/browsers.test.ts`
  - `tests/paths.test.ts`
- Task 2 passed sub-agent spec review.
- Task 2 code-quality review requested browser/profile path segment validation; fix was applied and re-review approved.
- Task 2 local verification passed:
  - `npm run build`
  - `npm run test -- tests/browsers.test.ts tests/paths.test.ts` (repo script ran full suite: 547 pass, 0 fail)
- Task 2 plan checkboxes are marked complete for steps 1-5; commit step remains open.
- Design spec exists and is committed at `docs/specs/2026-05-10-browser-bookmarks-design.md`.
- Implementation plan exists and is committed at `docs/plans/2026-05-10-browser-bookmarks-unified-index.md`.
- Repo instruction file exists and is committed at `AGENTS.md`.
- Worktree is dirty with Task 2 implementation and plan/ledger updates.
- Current remote verified as `origin https://github.com/manikanda-kumar/fieldtheory-cli` for fetch and push.

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

Now:
- Browser bookmark implementation is underway with sub-agent-driven task execution.
- Task 2 is implemented, reviewed, and verified, pending commit.

Next:
- Commit Task 2 when ready: `git add src/paths.ts src/browsers.ts tests/browsers.test.ts tests/paths.test.ts docs/plans/2026-05-10-browser-bookmarks-unified-index.md CONTINUITY.md && git commit -m "feat: add browser bookmark cache paths"`.
- Continue to Task 3: Chromium and Safari bookmark extraction.
- Before claiming DONE for implementation, satisfy the plan’s DONE checklist, including:
  - `ft sync-browser --browser chrome --bookmarks-file <fixture>` writes raw JSONL.
  - `ft sync-browser --browser vivaldi --bookmarks-file <fixture>` writes raw JSONL.
  - Safari sync imports on macOS or fails with a clear platform/path error.
  - Canonical rebuild dedupes one-clear-link X bookmarks with matching browser URLs.
  - Canonical rebuild does not dedupe X bookmarks with multiple external URLs.
  - `ft search --unified`, `ft list --unified`, `ft show --unified`, and `ft classify --unified --regex` work.
  - Existing X-only flows remain unchanged unless explicitly intended.
  - `ft sync` does not fetch media by default.
  - `ft sync --media` fetches media after sync.
  - `npm run build` and `npm run test` pass.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: whether unified search should become the default after the explicit `--unified` rollout proves stable.
- UNCONFIRMED: whether `--all` and `--all-profiles` should be implemented in the first browser sync PR or deferred after single-browser sync is stable.
- UNCONFIRMED: exact Safari plist parsing mechanism to use in code; plan currently allows macOS platform-native parsing with a clear failure path.
- UNCONFIRMED: whether browser bookmark deletion history should be retained long-term or raw snapshots should remain current-state only with `bookmark_sources.active` preserving provenance.
- UNCONFIRMED: whether webpage fetching/canonical URL resolution should be added later to improve browser-only classification and dedupe quality.

Working set (files/ids/commands):
- Docs: `docs/specs/2026-05-10-browser-bookmarks-design.md`, `docs/plans/2026-05-10-browser-bookmarks-unified-index.md`, `AGENTS.md`, `CONTINUITY.md`.
- Current implementation files: `src/browsers.ts`, `src/paths.ts`, `tests/browsers.test.ts`, `tests/paths.test.ts`.
- Remaining implementation plan target files: `src/browser-bookmarks.ts`, `src/canonical-bookmarks-db.ts`, `src/bookmark-classify.ts`, `src/cli.ts`, `README.md`.
- Planned tests: `tests/url-normalize.test.ts`, `tests/browser-bookmarks.test.ts`, `tests/canonical-bookmarks-db.test.ts`, plus existing X regression tests.
- Recent commits: `fa2d995 feat: add bookmark URL dedupe keys`, `7ce567f docs: use generic planning folders`, `98a0320 docs: plan browser bookmark sync`.
- Remote: `origin https://github.com/manikanda-kumar/fieldtheory-cli`.
- Useful commands: `npm run build`, `npm run test`, `npm run dev -- sync --help`, `npm run dev -- sync-browser --browser chrome --profile Default --bookmarks-file <path>`, `npm run dev -- search --unified <query>`.
