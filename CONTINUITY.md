Goal (incl. success criteria): Daily digest "no-item-left-behind" hardening (plan docs/plans/2026-07-10-001-fix-daily-digest-no-item-left-behind-plan.md) — every collected item renders exactly once, overflow carries over, digests report coverage truthfully. Success: reconciliation invariant collected = themed + also-saved; 822/822 suite green.
Constraints/Assumptions:
- Orchestration: Codex gpt-5.6-terra medium via use-harness router; per task implement → review → fix → close. Orchestrator verifies independently (diff + full suite), never trusts worker self-report.
Key decisions:
- Orphans render in mechanical "## Also saved" (no LLM re-pass); cross-theme duplicate citations dedupe without polluting droppedCitations (invalid-alias drops only).
- Overflow: oldest-first drain, `(first_saved_at, canonical id)` cursor persisted as lastRunAt + lastRunItemId; cursor applied only when effective sinceIso equals persisted watermark instant (clamp-safe). carriedOver=0 → watermark = untilIso, cursor cleared.
- `ft daily --date` (historical) never writes daily meta (was rewinding live watermark — bug found during brainstorm, fixed).
- Coverage footer mechanical, never LLM: 5-source freshness probes (per-source meta timestamps, try/catch → unknown/never synced), dark-sources line (x-list, following not in canonical), run counts in footer + frontmatter. Undateable count = canonical-total (labeled honestly; window attribution impossible for unparseable dates). X freshness = max(full, incremental) via latestBookmarkSyncAt.
State: T1 (R1–R4), T2 (R5–R7), T3 (R8–R11) committed 6b7a247, pushed. T4 (thin-content filter: contentLength strips URLs, THIN_CONTENT_CHARS=120, thin items skip LLM prompt → Also saved, thin_skipped count) + T5 (link enrichment: src/llm/opencode-client.ts zen/go deepseek-v4-flash, src/daily/enrich.ts fetch+summarize thin links, link_enrichment cache table survives rebuilds, SSRF guards, 30s LLM timeout, 200KB body cap everywhere, maxTokens 2000 — 600 starved reasoning model to empty content, found via live smoke) verified 833/833 + live E2E (real page → real summary cached ok).
Done:
- Ideation doc docs/ideation/2026-07-10-daily-digest-surprise.html (idea #0 coverage + 7 surprises + skip-vector map).
- Requirements plan docs/plans/2026-07-10-001-fix-daily-digest-no-item-left-behind-plan.md (ce-brainstorm).
- T1–T3 implemented via Codex; new module src/daily/coverage.ts.
Now:
- Sql.js writer hardening complete: unique atomic save temp names; advisory lock (2m wait, 250ms poll, 10m stale takeover warning); canonical rebuild + enrichment cache writes lock the whole open→modify→save window; cache batches are 50. Requested tests/build pass. No commit.
Next:
- Hand off worker report; user may review/commit then run the backfill.
Open questions (UNCONFIRMED if needed):
- None.
Working set (files/ids/commands):
- src/daily/{coverage,collect,connect,enrich,synthesize}.ts; src/llm/opencode-client.ts; src/cli.ts; tests/{daily,opencode-client}.test.ts; `node --import tsx --test tests/daily.test.ts tests/opencode-client.test.ts` = 30/30; `npm run build` ✓; `.harness/runs/*` (codex receipts)

VISION SESSION (2026-07-07) — daily-synthesis companion agent:
- Goal: agent that synthesizes all consumed data (X bm, YT playlists, Raindrop, GitHub stars, following, x-lists) daily, learns interests, proactively recalls during any project/research ("we studied that last week", "gotcha in blog X", "hot on X right now").
- Existing substrate: sync-all orchestrator, canonical FTS db (10k+ bookmarks), ft research/ask --json, library md wiki, following/experts index, x-list daily digests, daily-sync plan doc (docs/plans/2026-06-21-daily-sync-second-brain.md).
- Grounding decision: NO project dumps — ingest from ground truth directly: ~/Github repos (248, 51 with CONTINUITY.md Goal/Now/Next), Claude JSONL (~/.claude/projects/*, 73 dirs, type:"user" lines), Codex ~/.codex/sessions, OpenCode opencode.db. github-sessions/agent-sessions apps = viewers only.
- PLAN WRITTEN: docs/plans/2026-07-07-companion-agent-daily-synthesis.md — Phase A `ft sync-projects` (7th source, src/projects/, Claude sessions v1), Phase B `ft daily` (digest + interests.md, SQL connect + LLM synthesize w/ citation validation), Phase C global second-brain skill. 9-step build order.
- APPROVED (2026-07-07): implement via codex (gpt-5.5, codex:codex-rescue subagent), fable reviews each step until OK, then next. Defaults locked: scan root ~/Github, 14d prompt retention, droid+deepseek-v4-flash digest model. Commit per step (no attribution trailer), no push until asked.
- DONE Step 1 (COMMITTED c346a67): src/projects/ scanner. Codex implemented; fable review found+fixed 3 issues: (1) bare-label ledger headings "Goal (incl. success criteria):" no-dash format (dominant real format — regex made dash optional + sibling-label terminators), (2) bold "- **Goal:**" format, (3) README HTML lines leaking into description. Live verify: 152 repos/7s/0 errors, 26/26 ledgers extracted, active md clean, tests 10/10, full suite 778/778.
- DONE Step 2 (COMMITTED 464c95c): src/projects/sessions.ts — Claude JSONL prompt extraction (encoded-dir decode strips scan-root prefix first, hyphen candidates; type:user filter; 14d retention; incremental mtime+size skip with prompt merge from previous records) + "Recent agent queries" md section + "Recent focus" active-list line + 0.5x prompt-recency ranking weight. Fable review fix: filter ALL '<'-leading content (task-notification harness noise polluted prompts). Live: 10 repos w/ prompts, 104 prompts, ft-cli 26 real questions, incremental rerun faster. Tests 15/15, full 783/783.
- DONE Step 3 (COMMITTED 9afe2a2): canonical integration (source='project', GitHub-remote dedupe merges w/ stars else project:<repo>, prompt text 4K cap) + `ft sync-projects` CLI (--root/--max-age-days/--no-sessions/--dry-run, canonical rebuild after) + sync-all 'projects' step + getProjectsStatus + remoteUrl normalization (git@→https). Codex hit SESSION LIMIT (resets 10am IST) mid-run but implementation was complete — fable verified: build clean, focused 71/71, live `ft sync-projects` 152 repos indexed, `ft list --unified --source project` + unified search return goals+prompts. Fable fix: filter "This session is being continued..." compaction-summary prompts. Full suite 790/790.
- CODEX LIMIT: gpt-5.5 session limit until 10am IST. Steps 4+ = fable implements directly (user standing permission to override model choice) unless user prefers waiting.
- Learnings: git add <dir> fails via git wrapper — add files individually. tsx -e no top-level await — use .mts script. dcg hook blocks rm -rf — use fresh scratch dir names. Live-verify scratch: scratchpad/step{1,2,3}-live via FT_DATA_DIR sandbox.
- DONE Step 4 (COMMITTED 5708634, implemented by FABLE directly — codex limit): src/daily/{paths,collect,connect}.ts + canonical helpers getCanonicalBookmarksSince/findRelatedCanonicalBookmarks/relatedSeedTerms + `ft daily` CLI (--date/--window-hours/--json; watermark from daily/meta.json, 7d cap, digest write deferred to step 5). FIX during review: projectSourceFromRecord savedAt no longer falls back to scannedAt (commit-less repos flooded daily window as "new" every rescan — 138→6 items after fix). Tests tests/daily.test.ts 5/5, full 795/795. Live verified: related links sane (agent-sessions-active→agent-sessions).
- DONE Step 5 (COMMITTED 5f2384f, fable): src/daily/synthesize.ts — buildDailyPrompt (withSystemOverride hardened), validateThemes (every cited id must exist in collected set; hallucinated ids dropped + counted; theme w/ zero valid items dropped), mechanical fallback on LLM failure, digest md w/ frontmatter (synthesis: llm|mechanical) + [[project:*]] wikilinks, watermark advance on write only. CLI: ft daily --write/--force/--engine/--model/--effort; existing digest guarded unless --force. LIVE VERIFIED droid/deepseek-v4-flash: 3 coherent themes from 6 items, valid citations, older-save connections. Tests 8/8, full 798/798.
- DONE Step 6 (COMMITTED 0be6d70, fable): src/daily/interests.ts — topic velocity (7d vs 30d baseline, rising/steady/fading), active threads (terms in BOTH recent saves AND agent prompts), experts matched to rising topics from following.jsonl, ≤80-line hard cap, written to library/interests.md on every ft daily --write. Review fixes from real-data preview: exclude website hostnames (primary_domain holds "youtube.com") + "unclassified" from topics. Real preview sane: rising=technique/research/launch/security, steady=tool, fading=(github.com now filtered). Tests 9/9, full 799/799.
- DONE Step 7 (COMMITTED 6aca30c, fable): sync-all tail step 'daily' (ft daily --write, after canonical-md, disabled by --no-synthesis). CRITICAL FIXES found via production run: (1) first_saved_at mixes ISO+offset and Twitter-format "Wed Sep 30..." strings — ALL windowing/beforeIso comparisons switched from string to Date.parse epochs (collect, getCanonicalBookmarksSince, findRelated beforeIso, interests) — before fix real digest had 0 items; (2) small models mangle long canonical hash ids — prompt now uses short aliases (i1/r1) mapped back locally (was 30 dropped citations→mechanical; after: 6 llm themes, 0 dropped); (3) multiline X titles broke md links — linkLabel one-lines. PRODUCTION LIVE: ~/.fieldtheory/library/daily/2026-07-06.md = 14 items, 6 themes (dream-mode stars ↔ X memory posts ↔ YT talk ↔ skills project — vision working), interests.md live. sync-all dry-run shows full 8-step plan. Tests 10/10 daily, full 801/801.
- DONE Step 8 (COMMITTED 9471406, fable): global skill ~/.claude/skills/second-brain/SKILL.md (recall ladder: interests.md+projects-active.md always → daily digests for temporal → ft research/sqlite3 for topics → library md deep-read → conversational surfacing w/ dates; sqlite3 fallback for old ft binaries) + docs/AGENTS-recall.md (cross-agent contract: artifact table, ladder, rules incl. mixed-timestamp warning + prompt-privacy note) + CLAUDE.md pointer. Skill registered live this session. Verified artifacts: interests.md 25 lines, projects-active.md 57, 2 daily digests, repo ft research returns ranked hits.
- ALL 8 STEPS COMPLETE. Commits: c346a67, 464c95c, 9afe2a2, 5708634, 5f2384f, 0be6d70, 6aca30c, 9471406 (8 commits on main, not pushed).
- NOTE: global ft binary (1.3.22 npm) predates sync-projects/daily/research — user should npm update or run from repo until published.
- DONE Step 9 (COMMITTED be3964e, fable): multi-agent session ingestion — codex (~/.codex/sessions/yyyy/mm/dd/rollout-*.jsonl, cwd in session_meta), amp (~/.local/share/amp/threads/T-*.json, repo from env.initial.trees uri, thread created ts), pi (~/.pi/agent/sessions/<enc>/, cwd in type:"session" header), droid (~/.factory/sessions — TWO layouts: current <encoded-cwd>/<id>.jsonl w/ cwd in session_start header + legacy flat via sessions-index.json). Per-BLOCK noise filtering (droid packs env-dump + real prompt in one message), '# Task Tool Invocation' subagent noise filtered. User decision: pi+droid in, opencode skipped (rarely used). Tests hermeticSessionRoots guard real stores; 25/25 projects, full 810/810. Live: claude 113 + codex 109 + pi 5 + droid 1 prompts (amp 0 = no threads in 14d window, verified legit). Production resync: 17 repos w/ prompts (was 10).
- DONE Step 10 (COMMITTED 2e5094a): nightly sync-all launchd job LIVE.
  - Wrapper ~/.fieldtheory/sync-all.sh: runs repo dist (node ~/Github/fieldtheory-cli/dist/cli.js — NOT stale global ft), --x-list 1979812953135497678 --playlist PLVmtzF5bqCTLutxk2SQvcH2SgCjwNWobk --youtube-limit 8 --classify, extra args pass-through for smoke tests, log ~/.fieldtheory/sync-all.log.
  - Plist ~/Library/LaunchAgents/dev.fieldtheory.sync-all-daily.plist @ 09:00 daily, loaded (launchctl bootstrap, state=waiting).
  - Secrets: ~/.fieldtheory/.env (0600) w/ OPENCODE_GO_API_KEY + OPENROUTER_API_KEY (CLI auto-loads via config.ts). RAINDROP_TOKEN absent → raindrop step skips gracefully.
  - Digest engine pinned via new FT_DAILY_ENGINE/FT_DAILY_MODEL/FT_DAILY_EFFORT env fallbacks (wrapper sets droid + deepseek-v4-flash) — unattended runs never fall back to claude CLI.
  - RETIRED dev.fieldtheory.xlist-daily (booted out; plist moved to ~/.fieldtheory/x-lists/*.retired — x-list now inside sync-all, no double-fetch).
  - Smoke test: wrapper --only projects --no-synthesis → exit 0, projects+index ran, plan printed correctly. Full suite 810/810.
- State: companion pipeline FULLY WIRED: 7 sources incl. 5-agent session ingestion → nightly digest+interests @ 09:00 → recall via second-brain skill. 10 commits on main unpushed (c346a67..2e5094a).
- RAINDROP LIVE (2026-07-08, COMMITTED f3e7371): user pointed at RAINDROP_TEST_TOKEN (client honors it alongside RAINDROP_TOKEN). Appended to ~/.fieldtheory/.env; wrapper now `set -a; source ~/.fieldtheory/.env` (CLI's own dotenv reads ~/.fieldtheory/bookmarks/.env — dataDir — NOT ~/.fieldtheory/.env, and sync-raindrop never calls loadEnv; sourcing in wrapper covers all subcommands). Verified clean-env dry-run OK. First full backfill: 13,378 raindrop bookmarks, 7 collections → canonical 21,735 rows, classified 7,503. FIX: syncRaindropBookmarks now mkdirs raindrop dir up front (resume state written per-page hit ENOENT on first-ever run). Suite 810/810.
- PUSHED (2026-07-08): all 11 commits 183ad50..f3e7371 → origin/main. CONTINUITY.md + docs/plans left uncommitted per convention.
- NIGHTLY RUN VERIFIED (2026-07-08): launchd fired 09:00, all 8 steps ✓, exit=0 09:35 (md export slow — first full 21.7k canonical export post-raindrop). Digest 2026-07-08.md written.
- SLEEP-PROOFING (2026-07-08): launchd catches up missed 09:00 on wake (free). Self-wake needs user-run `sudo pmset repeat wakeorpoweron MTWRFSU 08:58:00` — suggested, UNCONFIRMED if user ran it. Pi 5 assessed as always-on alternative: chrome-cookies.ts HAS Linux path (v10/v11), residential IP safe; blocker = projects source (Mac repos+sessions) → would need Mac rsync of projects.jsonl. Cloud VM rejected (projects dead, X datacenter-IP risk).
- DONE (COMMITTED 42399b7): daily digest links YouTube items/related refs to library notes md — extractYoutubeVideoId + buildYoutubeNotesLinks (state.json lookup, pathExists guard, digest-relative link) in src/daily/synthesize.ts. Live verified: 7 [notes](../youtube/...) links in regenerated 2026-07-08 digest, month segments correct. Tests 12/12 daily, full 812/812.
- NOTEBOOKLM LIVE (2026-07-10): weekly-rotated digest auto-push wired. CLI = notebooklm-mcp-cli (`~/.local/bin/nlm`, uv tool, unofficial; auth via `nlm login`, expires periodically → sync-all.log shows "nlm: push FAILED"). sync-all.sh tail after exit 0: one notebook per ISO week "Field Theory <YYYY-Www>" (auto-created via `nlm notebook create` + jq, id cached ~/.fieldtheory/nlm/week-<w>.id; FT_NLM_NOTEBOOK overrides), pushes today's digest + every [notes](../youtube/*.md) file it references (title = notes H1), per-week manifest week-<w>.pushed dedupes. W28 notebook id a37e16ac-340d-4bf6-9f8e-7b2b1dd7a463, renamed "Field Theory 2026-W28", 11 sources live (digests 07-08/09/10 + 8 notes). Verified: smoke run pushed 8 notes, dedupe idempotent, manifest==source count. NOTE: 07-09/07-10 digests originally lacked notes links (launchd ran pre-feature dist); 07-10 regenerated --force. Source budget/wk ≈ 7 digests + ~40 notes < 50 free cap.
- Next (optional): weekly rollups, x-list canonical ingest (GAP-3).

SYNC-FAILURE DIAGNOSIS (2026-07-07) — why `ft sync` failed 6 Jul:
- Symptom: user's `ft sync` (~23:28 IST 6 Jul) died mid-run. jsonl had 23 new records (checkpoint 18:14 UTC) but bookmarks-meta.json/backfill-state stuck at 4 Jul, bookmarks.db not rebuilt → hard abort BEFORE final writes (graphql-bookmarks.ts:799-817). 429 rate-limit is handled gracefully (writes meta), so NOT rate-limit stop → cause = thrown error, most likely undici `Error: fetch failed` (same error killed x-lists daily.log run 5 Jul 09:28) or Ctrl-C. No crash reports, no sync log exists to recover exact message.
- Amplifier: 10,150 bookmarks ≥ 9,500 → auto-continue scans ~508 pages every incremental sync (~30 min with rate-limit backoffs) — huge window for network death. `fetchPageWithRetry` fetch() has NO timeout/AbortSignal (graphql-bookmarks.ts:444); `parseRetryAfterSec` honors x-rate-limit-reset unbounded (up to ~15 min × 4 attempts).
- RECOVERED: reran `ft sync` (bg, 31 min, stopReason "max runtime reached" — normal) → exit 0, 0 new remote, 23 stranded bookmarks indexed, total 10150, media fetched, index rebuilt, meta/state now 2026-07-06T19:05Z. State healthy.
- Possible fixes (not implemented): AbortSignal.timeout on fetch, cap retry-after wait, persist sync log, terminal-stop marker so auto-continue doesn't rescan 508 pages every run.

SYNC SESSION (2026-07-01) — sync youtube playlist + github stars:
- Goal: run `ft sync-github-stars` + `ft sync-youtube` for last playlist `PLVmtzF5bqCTLutxk2SQvcH2SgCjwNWobk`.
- Decision: youtube LLM notes via droid engine, model `deepseek-v4-flash` (user req).
- Auth: gh authed (manikanda-kumar), OPENROUTER_API_KEY set. cookies-from-browser chrome + impersonate chrome for yt-dlp.
- Done: github-stars sync — already current (fetched 0, total 2288, newest 2026-07-01). Canonical index rebuilt. Build clean.
- Done: youtube sync complete (droid/deepseek-v4-flash) — 269 processed (211 done, 58 partial), 152 skipped-unchanged, 4 no-transcript, 0 failed. Index rebuilt ~/.fieldtheory/library/youtube/index.html.
- Done: both sources synced. No commits.
- FEATURE (2026-07-02) per-playlist index.html:
  - paths.ts: `youtubeLibraryIndexHtmlPath(playlistId?)` → `index-<id>.html` (safePathSegment guarded).
  - index-html.ts: extracted `toIndexEntry`; added `writeYoutubePlaylistIndex(playlistId)` — filters to `state.playlists[id].videoIds` (deduped via Set), returns null if no members have notes. `writeYoutubeIndexHtml` takes optional playlistId.
  - cli.ts sync-youtube: after global index, also writes per-playlist index (skips for --video-ids-file).
  - Notes markdown stays shared/deduped by videoId; only HTML index scoped. Cross-playlist video appears in both.
  - Tests: tests/youtube-index-html.test.ts (+2 scope/dedup/null), tests/paths.test.ts (+2 path/traversal). paths 6/6, index 3/3, cli 33/33. Build clean.
  - Verified live: index-PLVmtzF5bqCTLutxk2SQvcH2SgCjwNWobk.html = 419 entries = global (playlist covers whole library). Dedup bug caught (was 420 from duplicate videoId in playlist.videoIds).
- State: COMPLETE.

OCR-FUSION SESSION (2026-07-02) — feed slide OCR into notes prompt for slide-heavy conf talks:
- Goal: AI Engineer conf playlist PLcfpQ4tk2k0V1LNigteMgExP1rb4Hy8wn (82 vids, slide-heavy). Slide OCR text was captured but never fed to notes LLM.
- Change:
  - notes.ts: GenerateNotesInput +optional `slides?: SlideImage[]`; generateNotes builds `<untrusted_slide_ocr>` block (timestamped, deduped, budget 12K via buildSlideOcrBlock) + fusion instruction; block omitted when no OCR. New opt slideOcrCharBudget.
  - overview.ts: REORDERED — capture slides BEFORE generateNotes (slide gate uses classifyYoutubeVideoType(meta) pre-notes), then generateNotes({...fetched, slides: slideImages}).
  - Tests: youtube-notes.test.ts +1 (OCR inject/dedup/omit) 7/7. Build clean.
- VERIFIED live (flash, video LC3-P7v3yoI): slides 9, OCR rich; note now cites slide-only facts (50% traffic from agents, HTML 1993→React, 40% ctx utilization, YAML ~100 tokens), each keypoint tagged (Slide [MM:SS]). Big quality win vs transcript-only.
- Model comparison in progress: deepseek-v4-flash (done), deepseek-v4-pro + mimo-v2.5 (running). Isolated FT_DATA_DIR per model under scratchpad/mt-<model>/. Sample ids: UNzCG3lw6O0, LC3-P7v3yoI.
- MUST use `--overview slides` (default none = no slides captured). Deps present: yt-dlp, ffmpeg, summarize.
- Model compare done: all 3 fuse OCR identically (3/5 slide facts); flash best value (pro=+30% prose only, 12x cost; mimo lean, no upside). Comparison HTML: scratchpad/model-comparison.html.
- CHOSEN: deepseek-v4-flash + --overview slides for full run.
- Now: full 82-vid playlist sync running bg (task b3xgqt73j), real library, log scratchpad/full-run.log. First video done (6 slides). On completion writes global index.html + per-playlist index-PLcfpQ4tk2k0V1LNigteMgExP1rb4Hy8wn.html.
- DONE: full 82-vid run complete — 73 done, 2 partial, 6 skipped, 1 no-transcript, 0 failed. 75/82 have slides+OCR. Global index.html + index-PLcfpQ4tk2k0V1LNigteMgExP1rb4Hy8wn.html written.
- COMMITTED + PUSHED (2026-07-05): `183ad50 feat: OCR-fuse slides into notes and per-playlist index` (8 files, +197 -28). Both features (per-playlist index + OCR-fusion) in one commit. Build clean, 768/768 tests. origin/main efb94e7..183ad50. CONTINUITY.md + pngs/docs left uncommitted per convention.
- State: COMPLETE.

MAGICPATH FRONTEND SESSION (2026-06-27):
- Goal (incl. success criteria): Create a new MagicPath project for Field Theory and produce a better first-page/front-end concept for the project.
- Constraints/Assumptions: Used `MagicPath:magicpath` skill. MagicPath edits were limited to the code workspace's allowed files. Project URL should stay on a MagicPath canvas, not component previews.
- Key decisions: Created a new personal MagicPath project instead of modifying `My First Project`; designed a dense local-first knowledge-library dashboard grounded in Field Theory's sources: X bookmarks, Raindrop, GitHub stars, YouTube notes, X list digest, and following experts.
- State: New project `Field Theory Library Dashboard` exists at MagicPath project ID `421504403401502720`. Component ID `421504477854576640`, generatedName `safe-brook-2393`, revision `421504477854576641`. Project URL: `https://www.magicpath.ai/files/421504403401502720`.
- Done: Authenticated MagicPath CLI, created project, ran `code start`, authored React/Tailwind component in `/tmp/fieldtheory-magicpath-dashboard`, fixed JSX parse error, submitted successfully with `code submit --wait`.
- Now: Embedded browser control timed out while opening/checking the new project, so `magicpath-ai view 421504403401502720` was used as fallback to open it in the system browser.
- Next: Review the MagicPath canvas visually; if further edits are needed, resync/fetch the completed revision before editing because MagicPath reported local workspace staleness after asset URL normalization.
- Open questions: UNCONFIRMED whether the embedded browser recovered and is currently on the new project URL after the timeout.
- Working set (files/ids/commands): `/tmp/fieldtheory-magicpath-dashboard/src/components/generated/FieldTheoryLibraryDashboard.tsx`; `/tmp/fieldtheory-magicpath-dashboard/src/index.css`; `npx -y magicpath-ai create-project --name "Field Theory Library Dashboard" -o json`; `npx -y magicpath-ai code submit --dir /tmp/fieldtheory-magicpath-dashboard --wait -o json`.
- UPDATE (2026-06-27): User clarified this is a saved-knowledge-over-years product and asked to remove unwanted dashboard data / move it to subpages. Resynced component into `/tmp/fieldtheory-magicpath-dashboard-v2` with `code start --component 421504477854576640`; revised IA so Home is calm archive orientation + ask/search + "continue from memory"; moved source health, expert graph, and synthesis/pipeline details to `Library`, `Sources`, `People`, and `Synthesis` tabs. Submitted successfully as revision `421507232623120384`. Embedded browser verified at `https://www.magicpath.ai/files/421504403401502720` with markers `Saved knowledge`, `Personal archive over years`, `Sources`, `People`, `Synthesis`, `Continue from memory`. Local v2 workspace is stale after MagicPath asset normalization; resync before further edits.
- UPDATE (2026-06-27): Addressed browser comments: search must expose source tuning, and `Today` was missing. Resynced into `/tmp/fieldtheory-magicpath-dashboard-v3`; added `Today` top-level nav/page; added source chips (`All`, `X`, `Raindrop`, `GitHub`, `YouTube`, `People`) directly in the Home search card with explanatory source context. Submitted successfully as revision `421508741435887616`. Embedded browser verification found `Today Fresh saves and resurfacing` plus search source buttons inside the iframe. Local v3 workspace is stale after MagicPath asset normalization; resync before further edits.
- UPDATE (2026-06-27): User said v3 looked dated/90s and asked for modern systems quality. Resynced into `/tmp/fieldtheory-magicpath-dashboard-v4`; fixed search layout structurally with `.ft-query-row`; appended modern visual-system override: dark app sidebar, light high-contrast workspace, subtle radial accents, rounded command palette, horizontal source chips, stronger typography, contemporary cards, dark focused-view panel. Submitted successfully as revision `421509844743393280`. Embedded browser screenshot verified modernized layout and horizontal source chips. Local v4 workspace is stale after MagicPath asset normalization; resync before further edits.
- UPDATE (2026-06-27): User approved MagicPath direction and asked to translate to web UI. Implemented in repo `ft serve` shell without adding a frontend build pipeline. Modified `src/web/app-shell.ts` to use the MagicPath IA (`Home`, `Today`, `Library`, `Sources`, `People`, `Synthesis`), modern dark sidebar/light workspace visual system, command search card, source chips (`All`, `X`, `Raindrop`, `GitHub`, `YouTube`) backed by `/api/unified?source=...`, archive Home using real `/api/unified` + `/api/stats`, People from top authors, Synthesis from existing list context endpoint. Updated `tests/web-server.test.ts` shell smoke coverage. Verified `npx tsx --test tests/web-server.test.ts` pass (11/11), `npm run build` pass, local server `http://127.0.0.1:8765` running, Browser screenshots saved `/tmp/fieldtheory-magicpath-concept.png` and `/tmp/fieldtheory-web-ui-implementation-v2.png`; source chip and Today nav interactions verified in embedded browser. Current known visual deviation: implementation uses live data and current browser viewport, so vertical content extends below screenshot instead of fitting exactly in MagicPath's selected 1440x1100 canvas.

DROID ENGINE SESSION (2026-06-22) — third LLM engine + prompt hardening:
- Added `src/llm/droid-engine.ts`: routes LLM calls through OpenCode Go API (env OPENCODE_GO_API_KEY or ~/.local/share/opencode/auth.json). Model chain deepseek-v4-flash → mimo-v2.5 → deepseek-v4-pro; FT_DROID_MODEL/--model override.
- engine.ts: registered `droid` (async-only; sync invokeEngine throws clear error). Added withSystemOverride() + extractSystemPrompt() → system block routed via native channels (claude --system-prompt, codex personality="none" prefix, droid system msg).
- Hardened all task prompts (bookmark-classify-llm, following/classify, md-prompts, seeds-model, youtube/{notes,script,slides}) with system override; classify paths moved sync→invokeEngineAsync.
- README: engine/model/pricing docs. tests/engine.test.ts: +6 (droid detect, claude --system-prompt, extractSystemPrompt x3).
- VERIFIED: build clean; full suite 737/737. Required `npm install` first (node_modules was missing @types).
- COMMITTED (not pushed): `a36c93d feat: add droid engine and harden LLM system prompts` (12 files, +476/-70). Excluded CONTINUITY.md + docs/plans (convention).
- Non-blockers left: resolveModelChain dups primary at tail when --model = a fallback id; getDroidModelChain exported-unused.

REVIEW+FIX SESSION (2026-06-21) — thermo-nuclear review of `following` feature + fixes applied:
- Ran thermo-nuclear deep + code-quality rubrics (~/.agents/skills/cursor-plugins/thermos) over the X-following-roster diff.
- Verdict: request-changes. No security holes (SQL parameterized, FTS sanitized, bio prompt-injection guarded, twid same trust boundary).
- FIXED (steps 1-3):
  - C1+Q1: read paths (search/list/show/stats/getUnclassified + update) now go through openFollowingDb() → no more raw "no such table: following" before first sync. Added shared FOLLOWING_SELECT_COLUMNS + rowToFollowingBase() (killed 4× dup projection).
  - C2: added getReclassifiableFollowing() (NULL/''/'general'); LLM classify uses it so `--regex` then `classify-following` is no longer a no-op. getUnclassifiedFollowing kept for regex pass (tests pin its semantics).
  - C3: real wall-clock `deadline` threaded into fetchFollowing (replaced the page-count estimate); dead `started` removed.
  - C4: fetchFollowing breaks on empty page even when a cursor remains.
  - Q2: deleted unused formatFollowingSyncResult + its cli.ts import.
  - Q3: collapsed 3 cursor branches → `cursor = rebuild ? undefined : prev.cursor`.
  - Q4: cookies extracted ONCE (resolveBrowserSession exported from fetch.ts, reused by sync.ts → fetchFollowing gets csrf+cookie, no second Keychain prompt).
- DEFERRED: Q5 (`?? undefined` dead-noise), Q6 (sync invokeEngine → async) = step 4, not done.
- VERIFIED: npm run build clean; following 30/30 (was 27, +3 regression tests for C1/C2/C4); cli 30/30.
- COMMITTED + PUSHED: `530d7af feat: add X following roster with expertise index` (13 files; whole following feature + review fixes + spec). origin/main.
- Still uncommitted (intentional): CONTINUITY.md (convention), docs/plans/2026-06-21-daily-sync-second-brain.md (separate daily-sync workstream).

PLANNING SESSION (2026-06-21) — daily-sync + unified second-brain (synthesizes prior 2 audits below):
- GOAL: (A) all 6 sources sync daily; (B) synthesize into wiki queryable by user AND agents.
- Builds on existing audits in this ledger: "sync-command audit for daily-job wiring" + "Second-brain query surface audit" (10 GAPs).
- 6 sources: ft sync (X bm, Chrome→LOCAL), ft sync-following (Chrome→LOCAL), ft x-list (Chrome→LOCAL), ft sync-raindrop (token, headless), ft sync-github-stars (gh/token, headless), ft sync-youtube (OpenRouter+yt-dlp/ffmpeg, heavy/$).
- Locality verdict: 3 need Chrome cookies → MUST be LOCAL launchd on this Mac. So whole daily job is local.
- Plan = orchestrator cmd `ft sync-all` + one launchd plist (mirror existing x-list job) → then ft index + ft md --canonical + ft wiki. Agent layer = fix GAP-2 (ask unified) + document sqlite3 direct query (GAP-10) + GAP-9 research entrypoint.
- DECISIONS (user 2026-06-21): youtube = DAILY but capped (--limit). Scope = "sync + agent-ready query" (daily job + GAP-2 unified ask + GAP-9 research cmd + sqlite3 doc; defer x-list ingest/unified-wiki/full-YT-FTS). Agent access = ALL three (direct sqlite3, ft research/ask --json, grep markdown).
- NEXT: implement `ft sync-all` orchestrator → launchd plist → fix ft ask unified (GAP-2) → add `ft research <topic> --json` (GAP-9) → write agent research doc. Verify tokens (RAINDROP_TOKEN/GITHUB_TOKEN/OPENROUTER_API_KEY) first.

IMPLEMENTATION SESSION (2026-06-21) — X following roster with expertise index:
- Goal: sync the logged-in user's X/Twitter following list, classify each account by domain and expertise, store locally for search, expose CLI commands as "tier 2" of a local-first research ladder (bookmarks → experts → broader web).
- New module `src/following/` (types.ts, paths.ts, fetch.ts, db.ts, sync.ts, classify.ts).
  - Storage at `~/.fieldtheory/bookmarks/following/` (following.jsonl, following.db, meta.json). Uses `dataDir()` to respect `FT_DATA_DIR` in tests.
  - GraphQL Following endpoint: query ID `OLm4oHZBfqWx8jbcEhWoFw` (from twscrape, June 2026), operation `Following`. Configurable via `--query-id`.
  - Viewer ID extracted from `twid` cookie (URL-encoded `"u=<id>"`). Chrome + Firefox cookie extraction extended to also extract `twid` alongside ct0/auth_token.
  - SQLite FTS5 index with BM25 search over handle, name, bio, domains, expertise, expertiseSummary. Bookmark overlap computed from existing bookmarks.db.
  - Classification: LLM mode (reuses engine.ts + extractJsonArray from bookmark-classify-llm.ts) and regex mode (bio keyword matching).
  - Incremental sync with cursor in meta.json; idempotent upsert by userId; preserves classification on re-index.
- CLI commands added: `ft sync-following` (--rebuild, --continue, --classify, --regex, --browser, --cookies, --max-pages, --delay-ms, --query-id), `ft experts search/list/show/stats`, `ft classify-following` (--regex).
- `ft status --json` extended with `following` block (count, classifiedCount, lastUpdated, cachePath).
- Skill (`src/skill.ts`) updated with local-first research ladder: bookmarks → experts → external.
- README updated with following roster section + auth notes + research workflow.
- Cookie extraction: `extractChromeXCookies` and `extractFirefoxXCookies` now also extract `twid` cookie (backward compatible — extra cookie in header).
- Design spec: `docs/specs/2026-06-21-following-sync-design.md`.
- Tests: `tests/following.test.ts` — 27 tests covering twid parsing, GraphQL response parsing, record merging, FTS index build, search, list, show, stats, classification (regex), classification persistence. All pass.
- Verification: `npm run build` clean; `npm test` 729/730 pass (1 pre-existing engine test failure unrelated to this feature).
- PREF: user wants commits WITHOUT Co-Authored-By/attribution trailer.

RESEARCH SESSION (2026-06-21) — Second-brain / AI-agent query surface audit (read-only):
- Goal: map the full synthesis + query surface of the knowledge base (X bookmarks, Raindrop, GitHub stars, YouTube notes, X-list digests) to understand what interfaces an AI agent can use today and what is missing.
- Files read: src/canonical-bookmarks-db.ts, src/md-export.ts, src/bookmarks-db.ts, src/cli.ts, src/bookmark-classify.ts, src/youtube/notes.ts, src/youtube/state.ts, src/youtube/index-html.ts, src/x-list-html.ts, src/x-list-fetch.ts, src/md-ask.ts, src/md.ts, src/library.ts, src/companion-cli.ts, src/paths.ts, src/skill.ts.
- No code changed. Read-only investigation.

FINDINGS — what exists today for AI agent research:
  SQLite (bookmarks.db):
    - bookmark_sources table: one row per source (x/raindrop/github-stars/youtube), deduped via dedupe_key.
    - canonical_bookmarks table: merged rows with display_title, search_text (union of all source text), categories, primary_category, domains, primary_domain, source_count, first/last_saved_at, sources_json.
    - canonical_bookmarks_fts: FTS5 over display_title+search_text, porter/unicode61, BM25.
    - bookmarks table (X-only): 37 columns incl. article_text, quoted_tweet_json, engagement counts; FTS5 over text+author+article.
  CLI query interfaces (all support --json):
    - ft search "q" --unified --json            → CanonicalSearchResult[] (id, canonicalUrl, displayTitle, searchText, sources, score)
    - ft list --unified --json [--source x|raindrop|github-stars|youtube]  → CanonicalBookmarkListResult[] (+ categories, domains, timestamps)
    - ft search "q" --json [--author --after --before]  → X-only SearchResult[]
    - ft list --json [--category --domain --folder --query --author --after --before]  → X-only BookmarkTimelineItem[]
    - ft show <id> --json [--unified]           → single item detail
    - ft stats --json                           → totals + top authors + date range
    - ft status --json, ft paths --json         → paths + status
    - ft x-list <id> --json                     → live XListDigest JSON (tweets with engagement, links, quoted tweets)
    - ft library search "q" --json              → substring search over all .md files in ~/.fieldtheory/library/
    - ft library list --json                    → path+title+updatedAt for all library .md files
    - ft library show <path> --json             → full markdown content
    - ft ask "question" --json                  → LLM Q&A (L1: index.md, L2: category/domain/entity pages, L3: X FTS)
  Files greppable directly:
    - ~/.fieldtheory/library/bookmarks/*.md     — per-bookmark .md with YAML frontmatter
    - ~/.fieldtheory/library/youtube/<YYYY-MM>/<videoId>.md  — structured notes (tldr, key points, chapters, topics)
    - ~/.fieldtheory/library/youtube/index.html — JSON index embedded as <script id="youtube-index-data">
    - ~/.fieldtheory/bookmarks/youtube/state.json  — all video metadata (title, tldr, topics, artifacts paths) in one file
    - ~/.fieldtheory/x-lists/<listId>-<timestamp>.json  — persisted digest per x-list run
    - ~/.fieldtheory/library/categories/*.md, domains/*.md, entities/*.md  — LLM wiki pages
    - ~/.fieldtheory/library/index.md           — top-level wiki summary

GAP LIST (10 concrete gaps for second-brain/AI-agent use):
  GAP-1: ft list --unified does NOT accept --query/--category/--domain/--folder/--after/--before (errors out). The underlying SQL and listCanonicalBookmarks() support source filter only. Fix: wire filter args through to a new WHERE clause on canonical_bookmarks.
  GAP-2: ft ask grounding is X-only. src/md-ask.ts L3 calls searchBookmarks() (X FTS), not searchCanonicalBookmarks(). YouTube, Raindrop, GitHub Stars are invisible to ft ask. Fix: add a second L3 call to searchCanonicalBookmarks() and merge results.
  GAP-3: X-list digests are NOT ingested into the canonical index. ~/.fieldtheory/x-lists/*.json files are standalone. No FTS, no canonical row. Fix: add ft index-x-lists or auto-ingest from JSON on next sync.
  GAP-4: ft categories, ft domains, ft folders have no --json flag. getCategoryCounts()/getDomainCounts()/getFolderCounts() exist; only CLI wiring is missing.
  GAP-5: YouTube full chapter/key-points text is NOT in canonical FTS. Only tldr+keyPoints+topics go into bookmark_sources.text (via youtubeSourceFromVideo). Full chapter summaries live only in .md files. Fix: expand the search_text fed to canonical_bookmarks_fts.
  GAP-6: No unified wiki page for cross-source topics. index.md covers X only. No "AI category across Raindrop+X+GitHub+YouTube" page. Fix: ft wiki --unified or extend compileMd() to draw from canonical_bookmarks.
  GAP-7: ft wiki has no --json output. No machine-readable list of which pages were compiled, their paths, or content. An agent must use ft library list + ft library show to discover pages.
  GAP-8: ft search --unified passes --limit correctly at runtime (reads options.limit) but the help text for --unified doesn't advertise it. Minor doc gap only.
  GAP-9: No combined "research topic X" one-shot command. Agent needs: search --unified, library search, grep youtube notes, check x-list JSONs — four separate steps with no single aggregator.
  GAP-10: bookmarks.db is sql.js format but IS standard SQLite-compatible (db.export() produces standard binary). Direct sqlite3 CLI works: sqlite3 ~/.fieldtheory/bookmarks/bookmarks.db "SELECT display_title, canonical_url FROM canonical_bookmarks WHERE canonical_bookmarks_fts MATCH 'agents' ORDER BY last_saved_at DESC LIMIT 20". This is the most powerful query interface available today and needs no code changes.

LATEST SESSION (2026-06-21) — Read-only sync-command audit for daily-job wiring:
- Produced a complete map of every data-sync command and its daily-job requirements (no code changed).
- ft sync (X/Twitter): Chrome cookie DB + macOS Keychain required — Mac-local ONLY. No headless path unless --cookies <ct0> <auth> supplied externally. Writes bookmarks.jsonl + bookmarks.db. 30-min wall-clock cap, 600ms inter-page delay, incremental by default.
- ft sync-raindrop: fully headless. Needs RAINDROP_TOKEN env var only. Writes raindrop/bookmarks.jsonl + canonical tables in bookmarks.db. Daily safe, incremental.
- ft sync-github-stars: fully headless. Needs gh CLI (authenticated) or GITHUB_TOKEN/GH_TOKEN. Writes github-stars/stars.jsonl + canonical tables. Incremental via lastStarredAt cutoff. Daily safe.
- ft sync-youtube: partially headless. Public playlists + local LLM or OPENROUTER_API_KEY: headless. Cookie paths (--cookies-from-browser): Mac-local. Needs yt-dlp (optional but preferred), optionally ffmpeg + summarize CLI. Writes youtube/state.json, youtube/artifacts/, library/youtube/*.md + index.html. Idempotent via contentHash.
- ft x-list <id>: Mac-local only (Chrome cookie DB + Keychain; no --cookies bypass). Stateless — writes timestamped x-lists/<listId>-<stamp>.{html,json} + latest pointer each run. Daily safe.
- Existing daily wiring: ~/.fieldtheory/x-lists/run-daily.sh exists (hand-written shell wrapper for ft x-list --since-hours 24). No launchd plist found installed for it. No daily wiring exists for sync, sync-raindrop, sync-github-stars, or sync-youtube.
- Built-in launchd support exists only for ft possible nightly (ideas subsystem) via com.fieldtheory.possible.nightly.<id>.plist — separate from data sync.
- No files modified. No commits.


LATEST SESSION (2026-06-19) — X list digest graduated to `ft x-list` with sortable HTML:
- Goal: fetch all tweets from an X list for a time window, render HTML sortable by reposts/likes/replies/quotes/views. Built on the existing prototype (`c2fb18a`).
- New `src/x-list-fetch.ts` (`fetchXListDigest`, `parseListId`, `LIST_LATEST_TWEETS_QUERY_ID`): shared GraphQL fetch+parse+time-filter+drop-quoted-originals, extracted from the prototype script (single source of truth). Injectable `fetchImpl`/`now` for tests. Returns `{ listId, fetchedAt, tweets, rawPages, stats }`.
- `src/x-list-html.ts`: each `.tweet-card` now carries `data-likes/reposts/replies/quotes/views/time`; added sticky `.sortbar` toolbar + inline `<script>` that reorders cards within each `<section>` client-side, with a high/low direction toggle. Default sort = reposts desc.
- `src/cli.ts`: new `ft x-list <list>` command (`--since-hours`, `--count`, `--max-pages`, `--delay-ms`, browser/profile opts, `--query-id`, `--output`, `--html-output`, `--json`). Defaults HTML to `os.tmpdir()` and prints path.
- `scripts/prototype-fetch-x-list.ts` refactored to delegate to `fetchXListDigest`/`renderXListHtml` (killed duplicated GraphQL constants).
- Linkify: `linkifyText()` wraps bare http(s) URLs in tweet + quoted-tweet text as clickable anchors (escape-first, trailing punctuation kept out). +1 test.
- Verified: `npm run build` clean; x-list tests 18/18 pass (data attrs, zero-default, linkify). Live fetch ran: `ft x-list <ref> --since-hours 24 --max-pages 12 --browser chrome` = 1048 tweets, oldest 24.0h, stopReason max-pages (default max-pages 5 truncates busy lists — bump for full window). Sort verified (top RT @rudrank 98.7k). 232 in-text links clickable.
- COMMITTED `7ec8725 feat: add ft x-list command with sortable HTML digest` (6 files; CONTINUITY.md kept uncommitted per convention). Pushed to origin/main.
- FOLLOW-UP DONE (`6c65483`): persistent storage + link badges + daily job.
  - `src/paths.ts`: `xListsDir()`/`ensureXListsDir()` → `~/.fieldtheory/x-lists/`.
  - `src/cli.ts`: default output (no `--html-output`/`--output`) writes date-stamped `<listId>-<YYYY-MM-DD-HH-MM>.{html,json}` + stable `<listId>-latest.html`; persisted JSON strips `rawPages` (was 37MB → ~1MB); `--max-pages` default 5→12 so 24h covers busy lists.
  - `src/x-list-html.ts`: `linkType()` badges each external link (GitHub/YouTube/Hugging Face/arXiv/Blog/HN/npm/X/Reddit/Notebook/other=host) with colored `.link-badge`.
  - Daily job (macOS launchd, LOCAL — needs Chrome cookies, can't be cloud): `~/Library/LaunchAgents/dev.fieldtheory.xlist-daily.plist` (09:00), wrapper `~/.fieldtheory/x-lists/run-daily.sh` (edit `FT_XLIST_ID`; default list `1979812953135497678`), logs `daily.log`. Loaded + test run = 1040 tweets, exit 0.
  - Tests x-list-html 8/8 (added linkify, badges). Build clean. Pushed origin/main.
- FILTERS (`33e70c4`): cards tagged `data-link-types` (slugs from links); sticky `.filterbar` builds chips client-side only for types present (GitHub/YouTube/Hugging Face/Other…) with per-type counts; selecting filters cards + updates section counts, composes with sort. x-list-html 9/9 pass. Regenerated latest.html (github 20, youtube 5, hf 3, other 101).
- PREF: user wants commits WITHOUT Co-Authored-By/attribution trailer.

REVIEW SESSION (2026-06-14) — web caption transcript rung review:
- Reviewed untracked `src/youtube/captions.ts` (480 lines) + `tests/youtube-captions.test.ts`, and modified `src/youtube/fetch.ts` (+13/-5).
- Change: new Rung 2 `fetchWebCaptionTranscript` (youtubei get_transcript + caption tracks) inserted between yt-dlp (Rung 1) and timedtext (now Rung 3). `fetchText` signature widened to accept `init`; threaded to global fetch.
- Verified: `npm run build` clean; youtube-captions+youtube-fetch = 22/22 pass.
- Boilerplate guard from 88c507e (`isYoutubeBoilerplate`) still wraps ALL rungs — new rung protected from stub-overwrite regression.
- Findings: (1) DEAD CODE — REMOVED 4 unused fns (`numberValue`, `extractQuotedConfigValue`, `extractEscapedConfigValue`, `escapeRegExp`). (2) PERF — new rung fetches full watch-page HTML + youtubei POST ahead of cheaper timedtext when yt-dlp fails/absent; acceptable (timedtext commonly 429s; Rung1 success skips it). (3) FRAGILE — regex extractors non-greedy, degrade gracefully. No blocking bugs.
- COMMITTED 8ca3fb2 `feat(youtube): add web caption transcript rung` — staged ONLY the 4 transcript files. Rebuild clean, 22/22 pass. GitHub-stars (`src/github-stars/`, `tests/github-stars.test.ts`) + Raindrop md-export/canonical changes still UNCOMMITTED/untracked — separate change, untouched.

LATEST SESSION (2026-06-01) — GitHub Stars sync implemented from `docs/specs/2026-05-31-github-stars-sync-design.md`:
- Added GitHub Stars as a first-class source.
  - New module `src/github-stars/` (`types.ts`, `paths.ts`, `client.ts`, `sync.ts`).
  - Raw cache path: `~/.fieldtheory/bookmarks/github-stars/stars.jsonl`; metadata path: `~/.fieldtheory/bookmarks/github-stars/meta.json`.
  - Client uses GitHub REST `GET /user/starred?per_page=100&page=N&sort=created&direction=desc` with `Accept: application/vnd.github.star+json`.
  - Auth preference: try `gh api` first, fall back to token auth via `GITHUB_TOKEN`/`GH_TOKEN`.
  - Pagination supports newest-first incremental cutoff via `meta.lastStarredAt`, `--rebuild`, `--limit`, and `--dry-run`.
  - 429 / 5xx / GitHub-marked rate-limited 403 responses retry with bounded backoff; normal 401/403 auth failures fail fast with remediation.
- Added `ft sync-github-stars`.
  - Options: `--rebuild`, `--dry-run`, `--limit <n>`, `--classify`.
  - Successful non-dry sync writes JSONL/meta, rebuilds canonical index, and can regex-classify canonical rows.
- Integrated with canonical bookmarks.
  - `githubStarsSourceFromRecord()` creates `bookmark_sources.source = 'github-stars'`.
  - Dedupe uses `dedupeKeyForUrl(record.htmlUrl)`, so GitHub stars merge with Raindrop/X rows for the same repo URL.
  - `ft list --unified --source github-stars` is now supported.
  - Unified search/list/help text updated for X, Raindrop, GitHub Stars, and YouTube.
- Added GitHub-specific canonical Markdown export.
  - `ft md --canonical --source github-stars` emits deterministic metadata-only repository pages.
  - Frontmatter includes repo owner/name/id, language/topics, counts, archived/fork/default branch, saved/starred/pushed/updated/synced timestamps, `source: github-stars`, and `sources`.
  - Body includes description, `## Repository context`, `## Signals`, `## Links`, and conservative `## Related` links.
- Docs/tests:
  - README command/data docs updated.
  - Added `tests/github-stars.test.ts`; extended canonical, CLI, and markdown export tests.
  - Verification passed: `npm run build`; `npm test` (673 pass, 0 fail).
- SPEC REVIEW (2026-06-01): impl matches `docs/specs/2026-05-31-github-stars-sync-design.md`. Re-verified: build OK; stars=5/5, canonical+md+cli=45/45 pass. Run tests via `npx tsx --test <file>` (rtk mangles `vitest`/`npm test` output to "[RTK:PASSTHROUGH]"). Gap (1) FIXED 2026-06-02: skipped-record warning count added. `fetchGitHubStarsPage`→`{records,skipped}`, threaded through `fetchGitHubStars`→`syncGitHubStars`→CLI prints `⚠ skipped (malformed/missing repo URL)` when >0. +1 test (6/6 pass), build clean. Remaining gap: (2) gh subprocess is attempted before failing on missing auth (spec: "fail before network fetch"), acceptable.
- REVIEW+COMMIT (2026-06-15): Reviewed staged GitHub Stars integration; no blocking findings in the feature diff. Verified `npm run build` clean and focused affected tests pass (`npx tsx --test tests/github-stars.test.ts tests/canonical-bookmarks-db.test.ts tests/md-export.test.ts tests/cli.test.ts`: 51/51). Full `npm test` had one unrelated pre-existing engine assertion failure: `resolveEngine: codex args include skip-git-repo-check` expected args without `--config personality="none"`. Committed feature as `1d8e67e feat: add GitHub stars sync` (12 files). `CONTINUITY.md` remains uncommitted.
- LIVE SYNC (2026-06-15): Ran `npm run -s dev -- sync-github-stars --classify` against real GitHub auth/API. Result: fetched/added 2175, updated 0, total 2175, newest `starred_at` `2026-06-14T15:31:51Z`, cache `/Users/manik/.fieldtheory/bookmarks/github-stars/stars.jsonl`; canonical index rebuilt; classified 5098/11486 bookmarks. Verified latest rows via `npm run -s dev -- list --unified --source github-stars --limit 10`; generated preview via `npm run -s dev -- md --canonical --source github-stars --limit 10 --preview` at `/var/folders/zy/zrm8cltd7jn6n3ftg2k6_psw0000gn/T/fieldtheory-md-preview-1781468849318`.

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
