# Harness Run Summary

## Status

- Run ID: codex-20260710T191314Z-j49nec
- Harness: codex
- Task: implement
- Status: worker-failed
- Exit code: 1
- Retryable: true
- Needs human: false

## Routing

- Source: explicit-harness
- Rationale: User explicitly selected codex implement task recommends claude, codex, grok, droid.
- Prompt strategy: wrapped

## Command

codex exec --skip-git-repo-check -o /var/folders/zy/zrm8cltd7jn6n3ftg2k6_psw0000gn/T/codex-out-76877-1783710794814 --profile edit --model gpt-5.6-terra '# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T191314Z-j49nec
- Backend: codex
- Task type: implement
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: write-enabled
- Model: gpt-5.6-terra

## Objective

Extend the link-enrichment feature (src/daily/enrich.ts, link_enrichment cache table) with backlog coverage. Two parts:

1. New CLI command '\''ft enrich-backfill'\'' in src/cli.ts:
   - Walks ALL canonical_bookmarks rows that are enrichment-eligible (same eligibility as enrichThinItems: thin per contentLength < THIN_CONTENT_CHARS, http(s) canonical_url, not an x.com/twitter.com status URL) and not already status=ok in link_enrichment (failed rows respect the existing 7-day retry rule).
   - Reuses enrichThinItems machinery (or a shared core) — same SSRF guards, timeouts, concurrency 4, caching. Do not duplicate fetch/summarize logic.
   - Options: --limit <n> (default 100 per invocation), --dry-run (print eligible/pending counts and exit), --all (no limit cap). Progress line every 25 items (processed/ok/failed). Resumable by design: rerunning skips cached ok rows.
   - Exit summary: eligible, attempted, ok, failed, skipped-cached.
2. Merge summaries into the canonical index: in rebuildCanonicalIndex (src/canonical-bookmarks-db.ts), after building canonical groups, append cached ok summaries (link_enrichment, matched by canonical url) to that row'\''s search_text ('\'' summary: <text>'\'') before insert, so FTS search/research/connect all see enriched content. Must not break when the table is empty/missing. Note: ft daily'\''s in-memory merge at collect time then becomes redundant for already-indexed summaries — keep it (harmless, covers not-yet-reindexed items) but add a comment.
3. Tests: backfill dry-run counts; backfill enriches an eligible row via seams and skips it on rerun; rebuild merges an ok summary into search_text and FTS finds the item by a summary-only term; empty table no-op. Use existing patterns.

Run node --import tsx --test tests/daily.test.ts tests/canonical-bookmarks-db.test.ts tests/cli.test.ts && npm run build. Concise summary.

## Scope

Use the objective and named files as scope. Do not broaden unless required.

## Constraints

- Match existing repo patterns.
- Do not commit changes.
- If changing files, report exact files changed.
- If validation cannot run, say why.

## Expected deliverable

1. Summary
2. Evidence
3. Files changed
4. Commands run
5. Verification status
6. Blockers

## Result shape

summary: string
evidence: string[]
files_changed: string[]
commands_run: { command: string, exit_code: number | null, summary: string }[]
verification: { status: "passed" | "failed" | "not_run", details: string }
blockers: string[]'

## Worker result

No worker output recorded.

## Verification

not parsed

## Errors

- Phase: worker
- Code: WORKER_FAILED
- Message: Reading additional input from stdin...
2026-07-10T19:13:16.663533Z ERROR codex_core::session::session: failed to load skill /Users/manik/.agents/skills/alex-skills/publish-oss/SKILL.md: missing YAML frontmatter delimited by ---
2026-07-10T19:13:16.663957Z ERROR codex_core::session::session: failed to load skill /Users/manik/.agents/skills/alex-skills/publish-oss/SKILL.md: missing YAML frontmatter delimited by ---
2026-07-10T19:13:16.663959Z ERROR codex_core::session::session: failed to load skill /Users/manik/.agents/skills/cli-printing-press/testdata/golden/fixtures/dogfood-novel-doc-sync/cli/SKILL.md: missing YAML frontmatter delimited by ---
OpenAI Codex v0.144.1
--------
workdir: /Users/manik/Github/fieldtheory-cli
model: gpt-5.6-terra
provider: openai
approval: never
sandbox: workspace-write [workdir, /tmp, $TMPDIR]
reasoning effort: medium
reasoning summaries: none
session id: 019f4d72-c899-7d00-a19e-ef4df4044f1a
--------
user
# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T191314Z-j49nec
- Backend: codex
- Task type: implement
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: write-enabled
- Model: gpt-5.6-terra

## Objective

Extend the link-enrichment feature (src/daily/enrich.ts, link_enrichment cache table) with backlog coverage. Two parts:

1. New CLI command 'ft enrich-backfill' in src/cli.ts:
   - Walks ALL canonical_bookmarks rows that are enrichment-eligible (same eligibility as enrichThinItems: thin per contentLength < THIN_CONTENT_CHARS, http(s) canonical_url, not an x.com/twitter.com status URL) and not already status=ok in link_enrichment (failed rows respect the existing 7-day retry rule).
   - Reuses enrichThinItems machinery (or a shared core) — same SSRF guards, timeouts, concurrency 4, caching. Do not duplicate fetch/summarize logic.
   - Options: --limit <n> (default 100 per invocation), --dry-run (print eligible/pending counts and exit), --all (no limit cap). Progress line every 25 items (processed/ok/failed). Resumable by design: rerunning skips cached ok rows.
   - Exit summary: eligible, attempted, ok, failed, skipped-cached.
2. Merge summaries into the canonical index: in rebuildCanonicalIndex (src/canonical-bookmarks-db.ts), after building canonical groups, append cached ok summaries (link_enrichment, matched by canonical url) to that row's search_text (' summary: <text>') before insert, so FTS search/research/connect all see enriched content. Must not break when the table is empty/missing. Note: ft daily's in-memory merge at collect time then becomes redundant for already-indexed summaries — keep it (harmless, covers not-yet-reindexed items) but add a comment.
3. Tests: backfill dry-run counts; backfill enriches an eligible row via seams and skips it on rerun; rebuild merges an ok summary into search_text and FTS finds the item by a summary-only term; empty table no-op. Use existing patterns.

Run node --import tsx --test tests/daily.test.ts tests/canonical-bookmarks-db.test.ts tests/cli.test.ts && npm run build. Concise summary.

## Scope

Use the objective and named files as scope. Do not broaden unless required.

## Constraints

- Match existing repo patterns.
- Do not commit changes.
- If changing files, report exact files changed.
- If validation cannot run, say why.

## Expected deliverable

1. Summary
2. Evidence
3. Files changed
4. Commands run
5. Verification status
6. Blockers

## Result shape

summary: string
evidence: string[]
files_changed: string[]
commands_run: { command: string, exit_code: number | null, summary: string }[]
verification: { status: "passed" | "failed" | "not_run", details: string }
blockers: string[]
warning: Exceeded skills context budget of 2%. All skill descriptions were removed and 186 additional skills were not included in the model-visible skills list.
codex
I’ll inspect the existing enrichment, CLI, index rebuild, and test seams, then implement the smallest shared-path change and run the requested tests/build.
exec
/bin/zsh -lc "sed -n '1,240p' CONTINUITY.md && rg -n \"enrichThinItems|link_enrichment|rebuildCanonicalIndex|THIN_CONTENT_CHARS|enrich\" src tests/daily.test.ts tests/canonical-bookmarks-db.test.ts tests/cli.test.ts" in /Users/manik/Github/fieldtheory-cli
 succeeded in 0ms:
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
- Thin-link enrichment calibrated for live deepseek-v4-flash: client/enrichment default max tokens raised from 600 to 2000 so reasoning leaves room for `message.content`. Security review fixes retained. Focused tests 30/30 + build pass. Uncommitted.
Next:
- Optional: commit; x-list/following canonical ingest (dark sources); per-source watermark; ideation ideas #1–8 (audio briefing top pick).
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
- DONE Step 2 (COMMITTED 464c95c): src/projects/sessions.ts — Claude JSONL prompt extraction (encoded-dir decode strips scan-root prefix first, hyphen candidates; type:user filter; 14d retention; incremental mtime+size skip with prompt merge from previous records) + "Recent agent queries" md section + "Recent focus" active-list line + 0.5x prompt-recency ranking weight. Fable review fix: filter ALL '<'-leading content (task-[REDACTED] harness noise polluted prompts). Live: 10 repos w/ prompts, 104 prompts, ft-cli 26 real questions, incremental rerun faster. Tests 15/15, full 783/783.
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
tests/canonical-bookmarks-db.test.ts:12:  rebuildCanonicalIndex,
tests/canonical-bookmarks-db.test.ts:101:test('rebuildCanonicalIndex dedupes X external link with raindrop bookmark URL', async () => {
tests/canonical-bookmarks-db.test.ts:120:    const result = await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:142:test('rebuildCanonicalIndex stores raindrop source rows with null target_url', async () => {
tests/canonical-bookmarks-db.test.ts:153:    await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:170:test('rebuildCanonicalIndex indexes GitHub stars and searches repo metadata', async () => {
tests/canonical-bookmarks-db.test.ts:174:    const result = await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:190:test('rebuildCanonicalIndex creates project source rows and indexes project context', async () => {
tests/canonical-bookmarks-db.test.ts:194:    const result = await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:210:test('rebuildCanonicalIndex merges GitHub-remote project with matching GitHub star', async () => {
tests/canonical-bookmarks-db.test.ts:218:    const result = await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:230:test('rebuildCanonicalIndex uses stable project dedupe key for projects without remote URL', async () => {
tests/canonical-bookmarks-db.test.ts:234:    await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:251:test('rebuildCanonicalIndex caps project prompt text contribution', async () => {
tests/canonical-bookmarks-db.test.ts:259:    await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:280:    await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:301:test('rebuildCanonicalIndex dedupes GitHub star with raindrop bookmark URL', async () => {
tests/canonical-bookmarks-db.test.ts:313:    const result = await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:359:    await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:378:test('rebuildCanonicalIndex does not dedupe X bookmark with multiple external links against raindrop URL', async () => {
tests/canonical-bookmarks-db.test.ts:400:    const result = await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:411:test('rebuildCanonicalIndex skips malformed raindrop URLs without crashing', async () => {
tests/canonical-bookmarks-db.test.ts:430:    const result = await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:440:test('rebuildCanonicalIndex preserves canonical classification metadata across rebuilds', async () => {
tests/canonical-bookmarks-db.test.ts:451:    await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:466:    await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:492:    await rebuildCanonicalIndex();
tests/canonical-bookmarks-db.test.ts:500:test('rebuildCanonicalIndex migrates older canonical tables without classification columns', async () => {
tests/canonical-bookmarks-db.test.ts:549:    await rebuildCanonicalIndex();
tests/daily.test.ts:7:import { rebuildCanonicalIndex, relatedSeedTerms, type CanonicalRecentItem } from '../src/canonical-bookmarks-db.js';
tests/daily.test.ts:12:import { enrichThinItems, mergeEnrichmentSummaries } from '../src/daily/enrich.js';
tests/daily.test.ts:99:    await rebuildCanonicalIndex();
tests/daily.test.ts:119:    await rebuildCanonicalIndex();
tests/daily.test.ts:145:    await rebuildCanonicalIndex();
tests/daily.test.ts:185:    await rebuildCanonicalIndex();
tests/daily.test.ts:210:    await rebuildCanonicalIndex();
tests/daily.test.ts:233:    await rebuildCanonicalIndex();
tests/daily.test.ts:268:    await rebuildCanonicalIndex();
tests/daily.test.ts:312:    await rebuildCanonicalIndex();
tests/daily.test.ts:357:    await rebuildCanonicalIndex();
tests/daily.test.ts:387:    await rebuildCanonicalIndex();
tests/daily.test.ts:412:    await rebuildCanonicalIndex();
tests/daily.test.ts:446:    await rebuildCanonicalIndex();
tests/daily.test.ts:476:    await rebuildCanonicalIndex();
tests/daily.test.ts:507:    await rebuildCanonicalIndex();
tests/daily.test.ts:532:    await rebuildCanonicalIndex();
tests/daily.test.ts:547:test('daily: enriches a thin link into the prompt and reuses its durable cache', async () => {
tests/daily.test.ts:549:    await writeStars(dir, [starRecord({ id: 75, fullName: 'a/enriched-link', starredAt: '2026-07-06T12:00:00.000Z', description: 'brief' })]);
tests/daily.test.ts:550:    await rebuildCanonicalIndex();
tests/daily.test.ts:555:    const enrichment = await enrichThinItems(collection.items, {
tests/daily.test.ts:562:    mergeEnrichmentSummaries(collection.items, enrichment.summaries);
tests/daily.test.ts:563:    assert.equal(enrichment.enrichedCount, 1);
tests/daily.test.ts:567:      enrichedCount: enrichment.enrichedCount,
tests/daily.test.ts:568:      enrichedItemIds: [item.id],
tests/daily.test.ts:575:    assert.match(prompt, /enriched-link/);
tests/daily.test.ts:578:    await rebuildCanonicalIndex();
tests/daily.test.ts:579:    const cached = await enrichThinItems(collection.items, {
tests/daily.test.ts:583:    assert.equal(cached.enrichedCount, 1);
tests/daily.test.ts:587:test('daily: empty enrichment completion is cached as failed and leaves the item thin', async () => {
tests/daily.test.ts:589:    await writeStars(dir, [starRecord({ id: 76, fullName: 'a/empty-enrichment', starredAt: '2026-07-06T12:00:00.000Z', description: 'brief' })]);
tests/daily.test.ts:590:    await rebuildCanonicalIndex();
tests/daily.test.ts:593:    const enrichment = await enrichThinItems(collection.items, {
tests/daily.test.ts:597:    mergeEnrichmentSummaries(collection.items, enrichment.summaries);
tests/daily.test.ts:598:    assert.equal(enrichment.enrichedCount, 0);
tests/daily.test.ts:606:test('daily: enrichment silently no-ops without an OpenCode key', async () => {
tests/daily.test.ts:612:    const result = await enrichThinItems([{ id: 'thin', canonicalUrl: 'https://example.com/thin', displayTitle: 'thin', searchText: 'https://example.com/thin', sources: [], firstSavedAt: null, lastSavedAt: null, primaryCategory: null, primaryDomain: null }]);
tests/daily.test.ts:613:    assert.equal(result.enrichedCount, 0);
tests/daily.test.ts:622:test('daily: enrichment never fetches private IPs or redirects to them', async () => {
tests/daily.test.ts:626:    const privateResult = await enrichThinItems([thin('http://192.168.1.1/x')], {
tests/daily.test.ts:630:    assert.equal(privateResult.enrichedCount, 0);
tests/daily.test.ts:633:    const redirectResult = await enrichThinItems([thin('https://example.com/redirect')], {
tests/daily.test.ts:640:    assert.equal(redirectResult.enrichedCount, 0);
tests/daily.test.ts:645:test('daily: an OpenCode timeout records a failed enrichment without hanging', async () => {
tests/daily.test.ts:650:    const result = await enrichThinItems([item], {
tests/daily.test.ts:654:    assert.equal(result.enrichedCount, 0);
tests/daily.test.ts:657:    const cachedFailure = await enrichThinItems([item], {
tests/daily.test.ts:661:    assert.equal(cachedFailure.enrichedCount, 0);
tests/daily.test.ts:694:    await rebuildCanonicalIndex();
tests/daily.test.ts:712:    await rebuildCanonicalIndex();
tests/cli.test.ts:9:import { rebuildCanonicalIndex } from '../src/canonical-bookmarks-db.js';
tests/cli.test.ts:262:    await rebuildCanonicalIndex();
src/cli.ts:29:  rebuildCanonicalIndex,
src/cli.ts:50:import { enrichThinItems, mergeEnrichmentSummaries } from './daily/enrich.js';
src/cli.ts:450:    'Security: SSRF fix in article enrichment (redirect chains now validated per hop)',
src/cli.ts:789:    const canonical = await rebuildCanonicalIndex();
src/cli.ts:946:            console.log('  No gaps found \u2014 all bookmarks are fully enriched.');
src/cli.ts:950:            if (result.articlesEnriched > 0) console.log(`  \u2713 ${result.articlesEnriched} linked articles enriched`);
src/cli.ts:1277:      await rebuildCanonicalIndex();
src/cli.ts:1320:      await rebuildCanonicalIndex();
src/cli.ts:1348:      const enrichment = await enrichThinItems(collection.items, {
src/cli.ts:1349:        onMissingKey: () => console.error('  Link enrichment skipped: OPENCODE_GO_API_KEY or OPENCODE_API_KEY is not set.'),
src/cli.ts:1351:      mergeEnrichmentSummaries(collection.items, enrichment.summaries);
src/cli.ts:1364:          enrichedCount: enrichment.enrichedCount,
src/cli.ts:1365:          enrichedItemIds: collection.items.filter((item) => item.canonicalUrl && enrichment.summaries.has(item.canonicalUrl)).map((item) => item.id),
src/cli.ts:1378:        if (result.enrichedCount > 0) console.log(`    enriched links available: ${result.enrichedCount}`);
src/cli.ts:1460:      await rebuildCanonicalIndex();
src/cli.ts:2376:      const canonical = await rebuildCanonicalIndex();
src/bookmarks-db.ts:51:  enrichedAt?: string | null;
src/bookmarks-db.ts:171:    enrichedAt: (row[29] as string) ?? null,
src/bookmarks-db.ts:272:    enriched_at TEXT,
src/bookmarks-db.ts:344:    ensureColumn(db, 'bookmarks', 'enriched_at', 'TEXT');
src/bookmarks-db.ts:375:  enrichedAt: string | null;
src/bookmarks-db.ts:429:      preserved?.enrichedAt ?? null,
src/bookmarks-db.ts:452:    // Preserve classification and enrichment fields when refreshing existing rows.
src/bookmarks-db.ts:461:                quoted_tweet_json, article_title, article_text, article_site, enriched_at,
src/bookmarks-db.ts:476:          enrichedAt: (r[10] as string) ?? null,
src/bookmarks-db.ts:665:        b.enriched_at,
src/bookmarks-db.ts:813:        b.enriched_at,
src/bookmarks-db.ts:1212:      'UPDATE bookmarks SET article_title = ?, article_text = ?, article_site = ?, enriched_at = ? WHERE id = ?'
src/canonical-bookmarks-db.ts:316:  // Combine excerpt + note + highlights text for search_text enrichment
src/canonical-bookmarks-db.ts:662:export async function rebuildCanonicalIndex(_options: RebuildCanonicalOptions = {}): Promise<CanonicalRebuildResult> {
src/canonical-bookmarks-db.ts:768:  return rebuildCanonicalIndex();
src/md-export.ts:64:  const values = [b.syncedAt, b.enrichedAt]
src/md-export.ts:470:  // Load Raindrop records for enrichment
src/types.ts:77:  enrichedAt?: string | null;
src/graphql-bookmarks.ts:10:import { fetchArticle, resolveTcoLink } from './bookmark-enrich.js';
src/graphql-bookmarks.ts:11:import type { ArticleContent } from './bookmark-enrich.js';
src/graphql-bookmarks.ts:522:  if (existing.enrichedAt && !incoming.enrichedAt) {
src/graphql-bookmarks.ts:523:    merged.enrichedAt = existing.enrichedAt;
src/graphql-bookmarks.ts:1799:  const enrichedIds = new Set<string>();
src/graphql-bookmarks.ts:1805:      const rows = db.exec('SELECT id FROM bookmarks WHERE enriched_at IS NOT NULL');
src/graphql-bookmarks.ts:1806:      for (const row of rows[0]?.values ?? []) enrichedIds.add(row[0] as string);
src/graphql-bookmarks.ts:1809:  return enrichedIds;
src/graphql-bookmarks.ts:1832:  const enrichedIds = await readEnrichedBookmarkIds();
src/graphql-bookmarks.ts:1848:    !enrichedIds.has(r.id) && isLinkOnlyBookmark(r) && (r.links ?? []).some(isXArticleUrl)
src/graphql-bookmarks.ts:1955:        if (enrichedIds.has(record.id)) continue;
src/graphql-bookmarks.ts:1962:        enrichedIds.add(record.id);
src/graphql-bookmarks.ts:2001:  // ── Gap 3b: Article enrichment for ordinary link-only bookmarks ─────────
src/graphql-bookmarks.ts:2006:  // Filter to link-only bookmarks not yet enriched
src/graphql-bookmarks.ts:2008:    if (enrichedIds.has(r.id)) return false;
src/web/server.ts:143:async function enrichBookmark(item: BookmarkTimelineItem): Promise<BookmarkWebItem> {
src/web/server.ts:181:    sendJson(res, 200, await enrichBookmark(item));
src/llm/opencode-client.ts:43:/** Minimal OpenAI-compatible client for short link-enrichment completions. */
src/web/link-preview.ts:1:import { isSafeUrl, resolveTcoLink } from '../bookmark-enrich.js';
src/daily/enrich.ts:6:import { THIN_CONTENT_CHARS, contentLength } from './synthesize.js';
src/daily/enrich.ts:18:  enrichedAt: string;
src/daily/enrich.ts:31:  enrichedCount: number;
src/daily/enrich.ts:36:export async function enrichThinItems(items: CanonicalRecentItem[], options: EnrichThinItemsOptions = {}): Promise<EnrichThinItemsResult> {
src/daily/enrich.ts:38:  if (eligible.length === 0) return { enrichedCount: 0, summaries: new Map() };
src/daily/enrich.ts:41:    return { enrichedCount: 0, summaries: new Map() };
src/daily/enrich.ts:57:        if (!summary) throw new Error('empty enrichment completion');
src/daily/enrich.ts:58:        return { url, summary, status: 'ok', enrichedAt: now.toISOString() };
src/daily/enrich.ts:60:        return { url, summary: null, status: 'failed', enrichedAt: now.toISOString() };
src/daily/enrich.ts:66:    return { enrichedCount: finalSummaries.size, summaries: finalSummaries };
src/daily/enrich.ts:68:    return { enrichedCount: 0, summaries: new Map() };
src/daily/enrich.ts:81:  if (contentLength(item.searchText) >= THIN_CONTENT_CHARS || !item.canonicalUrl) return false;
src/daily/enrich.ts:97:  return !Number.isFinite(Date.parse(cached.enrichedAt)) || Date.parse(cached.enrichedAt) <= now.getTime() - FAILED_RETRY_MS;
src/daily/enrich.ts:118:    const rows = db.exec(`SELECT url, summary, status, enriched_at FROM link_enrichment WHERE url IN (${urls.map(() => '?').join(',')})`, urls)[0]?.values ?? [];
src/daily/enrich.ts:120:    return new Map(rows.map((row) => [String(row[0]), { url: String(row[0]), summary: row[1] == null ? null : String(row[1]), status: row[2] === 'ok' ? 'ok' : 'failed', enrichedAt: String(row[3] ?? '') }]));
src/daily/enrich.ts:131:    const statement = db.prepare(`INSERT INTO link_enrichment (url, summary, status, enriched_at) VALUES (?, ?, ?, ?)
src/daily/enrich.ts:132:      ON CONFLICT(url) DO UPDATE SET summary = excluded.summary, status = excluded.status, enriched_at = excluded.enriched_at`);
src/daily/enrich.ts:134:      for (const entry of entries) statement.run([entry.url, entry.summary, entry.status, entry.enrichedAt]);
src/daily/enrich.ts:145:  db.run('CREATE TABLE IF NOT EXISTS link_enrichment (url TEXT PRIMARY KEY, summary TEXT, status TEXT NOT NULL, enriched_at TEXT NOT NULL)');
src/daily/synthesize.ts:25:export const THIN_CONTENT_CHARS = 120;
src/daily/synthesize.ts:46:  /** Current digest items supplied with a cached or fresh link enrichment. */
src/daily/synthesize.ts:47:  enrichedCount?: number;
src/daily/synthesize.ts:49:  enrichedItemIds?: Iterable<string>;
src/daily/synthesize.ts:61:  enrichedCount: number;
src/daily/synthesize.ts:278:  lines.push(`enriched: ${coverage.counts.enriched}`);
src/daily/synthesize.ts:342:  lines.push(`- This run: collected ${coverage.counts.collected}; themed ${coverage.counts.themed}; also-saved ${coverage.counts.alsoSaved}; thin links skipped from synthesis ${coverage.counts.thinSkipped}; carried-over ${coverage.counts.carriedOver}; enriched links available to this digest ${coverage.counts.enriched}; citations dropped ${coverage.counts.citationsDropped}; undateable excluded (canonical total) ${coverage.counts.undateableExcluded}; synthesis ${coverage.counts.synthesis}.`);
src/daily/synthesize.ts:371:      enrichedCount: options.enrichedCount ?? 0,
src/daily/synthesize.ts:380:  const enrichedItemIds = new Set(options.enrichedItemIds ?? []);
src/daily/synthesize.ts:381:  const promptItems = collection.items.filter((item) => contentLength(item.searchText) >= THIN_CONTENT_CHARS || enrichedItemIds.has(item.id));
src/daily/synthesize.ts:425:    enriched: options.enrichedCount ?? 0,
src/daily/synthesize.ts:453:    enrichedCount: options.enrichedCount ?? 0,
src/youtube/overview.ts:69:  // Capture slides BEFORE generating notes so their OCR text can enrich the
src/daily/coverage.ts:25:  /** Current digest items with an enrichment summary available (cached or fresh). */
src/daily/coverage.ts:26:  enriched: number;

exec
/bin/zsh -lc "sed -n '1,240p' src/daily/enrich.ts && sed -n '630,760p' src/canonical-bookmarks-db.ts && sed -n '1,90p' src/cli.ts && sed -n '1280,1395p' src/cli.ts && sed -n '1,110p' tests/cli.test.ts && sed -n '530,680p' tests/daily.test.ts" in /Users/manik/Github/fieldtheory-cli
 succeeded in 0ms:
import type { CanonicalRecentItem } from '../canonical-bookmarks-db.js';
import type { Database } from 'sql.js';
import { openDb, saveDb } from '../db.js';
import { twitterBookmarksIndexPath } from '../paths.js';
import { createOpenCodeClient, openCodeApiKey } from '../llm/opencode-client.js';
import { THIN_CONTENT_CHARS, contentLength } from './synthesize.js';

const FAILED_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
const BODY_LIMIT_BYTES = 200_000;
const DEFAULT_LIMIT = 25;

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface LinkEnrichmentEntry {
  url: string;
  summary: string | null;
  status: 'ok' | 'failed';
  enrichedAt: string;
}

export interface EnrichThinItemsOptions {
  fetch?: FetchFn;
  llm?: (prompt: string) => Promise<string>;
  limit?: number;
  now?: Date;
  onMissingKey?: () => void;
}

export interface EnrichThinItemsResult {
  /** Items with a usable cached or newly generated summary in this digest. */
  enrichedCount: number;
  summaries: Map<string, string>;
}

/** Fetch/cache summaries for otherwise-thin daily items. This function never throws. */
export async function enrichThinItems(items: CanonicalRecentItem[], options: EnrichThinItemsOptions = {}): Promise<EnrichThinItemsResult> {
  const eligible = items.filter((item) => isEligible(item));
  if (eligible.length === 0) return { enrichedCount: 0, summaries: new Map() };
  if (!options.llm && !openCodeApiKey()) {
    options.onMissingKey?.();
    return { enrichedCount: 0, summaries: new Map() };
  }

  try {
    const now = options.now ?? new Date();
    const cached = await readCache([...new Set(eligible.map((item) => item.canonicalUrl!))]);
    const summaries = usableSummaries(eligible, cached);
    const limit = parseLimit(options.limit);
    const misses = eligible.filter((item) => shouldAttempt(item.canonicalUrl!, cached.get(item.canonicalUrl!), now)).slice(0, limit);
    const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
    const llm = options.llm ?? (async (prompt: string) => (await createOpenCodeClient().chat({ prompt, maxTokens: 2000 })).text);
    const updates = await mapConcurrent(misses, 4, async (item): Promise<LinkEnrichmentEntry> => {
      const url = item.canonicalUrl!;
      try {
        const material = await extractPageMaterial(url, fetchFn);
        const summary = (await llm(buildEnrichmentPrompt(material))).trim();
        if (!summary) throw new Error('empty enrichment completion');
        return { url, summary, status: 'ok', enrichedAt: now.toISOString() };
      } catch {
        return { url, summary: null, status: 'failed', enrichedAt: now.toISOString() };
      }
    });
    if (updates.length) await writeCache(updates);
    for (const update of updates) if (update.status === 'ok' && update.summary) cached.set(update.url, update);
    const finalSummaries = usableSummaries(eligible, cached);
    return { enrichedCount: finalSummaries.size, summaries: finalSummaries };
  } catch {
    return { enrichedCount: 0, summaries: new Map() };
  }
}

/** Append summaries to only the current collection's in-memory search text. */
export function mergeEnrichmentSummaries(items: CanonicalRecentItem[], summaries: Map<string, string>): void {
  for (const item of items) {
    const summary = item.canonicalUrl ? summaries.get(item.canonicalUrl) : undefined;
    if (summary && !item.searchText.includes(` summary: ${summary}`)) item.searchText = `${item.searchText} summary: ${summary}`.trim();
  }
}

function isEligible(item: CanonicalRecentItem): boolean {
  if (contentLength(item.searchText) >= THIN_CONTENT_CHARS || !item.canonicalUrl) return false;
  try {
    const url = new URL(item.canonicalUrl);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !isTweetStatusUrl(url);
  } catch {
    return false;
  }
}

function isTweetStatusUrl(url: URL): boolean {
  return /(^|\.)((x|twitter)\.com)$/i.test(url.hostname) && /\/status\/\d+/i.test(url.pathname);
}

function shouldAttempt(_url: string, cached: LinkEnrichmentEntry | undefined, now: Date): boolean {
  if (!cached) return true;
  if (cached.status === 'ok' && cached.summary?.trim()) return false;
  return !Number.isFinite(Date.parse(cached.enrichedAt)) || Date.parse(cached.enrichedAt) <= now.getTime() - FAILED_RETRY_MS;
}

function parseLimit(value: number | undefined): number {
  const raw = value ?? Number(process.env.FT_ENRICH_LIMIT ?? DEFAULT_LIMIT);
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : DEFAULT_LIMIT;
}

function usableSummaries(items: CanonicalRecentItem[], cache: Map<string, LinkEnrichmentEntry>, into = new Map<string, string>()): Map<string, string> {
  for (const item of items) {
    const entry = item.canonicalUrl ? cache.get(item.canonicalUrl) : undefined;
    if (item.canonicalUrl && entry?.status === 'ok' && entry.summary?.trim()) into.set(item.canonicalUrl, entry.summary.trim());
  }
  return into;
}

async function readCache(urls: string[]): Promise<Map<string, LinkEnrichmentEntry>> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  try {
    initEnrichmentSchema(db);
    const rows = db.exec(`SELECT url, summary, status, enriched_at FROM link_enrichment WHERE url IN (${urls.map(() => '?').join(',')})`, urls)[0]?.values ?? [];
    saveDb(db, dbPath);
    return new Map(rows.map((row) => [String(row[0]), { url: String(row[0]), summary: row[1] == null ? null : String(row[1]), status: row[2] === 'ok' ? 'ok' : 'failed', enrichedAt: String(row[3] ?? '') }]));
  } finally {
    db.close();
  }
}

async function writeCache(entries: LinkEnrichmentEntry[]): Promise<void> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  try {
    initEnrichmentSchema(db);
    const statement = db.prepare(`INSERT INTO link_enrichment (url, summary, status, enriched_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET summary = excluded.summary, status = excluded.status, enriched_at = excluded.enriched_at`);
    try {
      for (const entry of entries) statement.run([entry.url, entry.summary, entry.status, entry.enrichedAt]);
    } finally {
      statement.free();
    }
    saveDb(db, dbPath);
  } finally {
    db.close();
  }
}

function initEnrichmentSchema(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS link_enrichment (url TEXT PRIMARY KEY, summary TEXT, status TEXT NOT NULL, enriched_at TEXT NOT NULL)');
}

async function extractPageMaterial(url: string, fetchFn: FetchFn): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    let current = assertSafeFetchUrl(url);
    let response: Response | undefined;
    // DNS rebinding protection is out of scope: validate hostname/IP literals
    // before each request, while manual redirects prevent bypassing that check.
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      response = await fetchFn(current, { redirect: 'manual', signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FieldTheoryDigest/1.0)' } });
      if (!isRedirect(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      if (!location || redirects === 5) throw new Error('unsafe or excessive redirect');
      current = assertSafeFetchUrl(new URL(location, current).toString());
    }
    if (!response) throw new Error('no response');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await readLimitedBody(response, BODY_LIMIT_BYTES);
    const title = firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = firstMatch(html, /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']*)["']/i)
      ?? firstMatch(html, /<meta[^>]+content=["']([^"']*)["'][^>]+(?:name|property)=["'](?:description|og:description)["']/i);
    const visible = decodeHtml(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 1200);
    return [`URL: ${url}`, title && `Title: ${decodeHtml(title)}`, description && `Description: ${decodeHtml(description)}`, visible && `Text: ${visible}`].filter(Boolean).join('\n');
  } finally {
    clearTimeout(timer);
  }
}

function buildEnrichmentPrompt(material: string): string {
  return `For a personal knowledge digest, summarize what this page is about in 2-3 plain sentences. No preamble.\n\n${material}`;
}

async function readLimitedBody(response: Response, limit: number): Promise<string> {
  // A no-body response has no bytes to read; never fall back to response.text(),
  // which may buffer an unbounded body in nonstandard fetch implementations.
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit - size;
      chunks.push(value.byteLength > remaining ? value.slice(0, remaining) : value);
      size += Math.min(value.byteLength, remaining);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(all);
}

function assertSafeFetchUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported URL scheme');
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.local') || isPrivateIpLiteral(hostname)) {
    throw new Error('unsafe fetch host');
  }
  return url.toString();
}

function isPrivateIpLiteral(hostname: string): boolean {
  const octets = hostname.split('.');
  if (octets.length === 4 && octets.every((part) => /^\d+$/.test(part) && Number(part) <= 255)) {
    const [a, b] = octets.map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return hostname === '::' || hostname === '::1' || /^[fcfd][0-9a-f]{1,3}:/i.test(hostname);
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function firstMatch(text: string, pattern: RegExp): string | null {
  return pattern.exec(text)?.[1]?.trim() || null;
}

function decodeHtml(text: string): string {
  return text.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
  ];
}

function mapSearchRow(row: unknown[]): CanonicalSearchResult {
  return {
    id: row[0] as string,
    canonicalUrl: (row[1] as string) ?? null,
    displayTitle: (row[2] as string) ?? null,
    searchText: row[3] as string,
    sourceCount: Number(row[4] ?? 0),
    sources: parseSources(row[5]),
    score: Number(row[6] ?? 0),
  };
}

function mapListRow(row: unknown[]): CanonicalBookmarkListResult {
  return {
    id: row[0] as string,
    canonicalUrl: (row[1] as string) ?? null,
    displayTitle: (row[2] as string) ?? null,
    searchText: row[3] as string,
    sourceCount: Number(row[4] ?? 0),
    firstSavedAt: (row[5] as string) ?? null,
    lastSavedAt: (row[6] as string) ?? null,
    sources: parseSources(row[7]),
    categories: (row[8] as string) ?? null,
    primaryCategory: (row[9] as string) ?? null,
    domains: (row[10] as string) ?? null,
    primaryDomain: (row[11] as string) ?? null,
  };
}

export async function rebuildCanonicalIndex(_options: RebuildCanonicalOptions = {}): Promise<CanonicalRebuildResult> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);

  try {
    initCanonicalSchema(db);
    const preservedFields = readPreservedCanonicalFields(db);

    const sourceRows: CanonicalSourceInput[] = [];
    const xRecords = await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath());
    sourceRows.push(...xRecords.map(xSourceFromRecord));

    // Raindrop sources (replaces browser bookmarks)
    const raindropCachePath = raindropBookmarksCachePath();
    if (await pathExists(raindropCachePath)) {
      const raindropRecords = await readJsonLines<RaindropRecord>(raindropCachePath);
      const normalized = raindropRecords
        .map(raindropSourceFromRecord)
        .filter((row): row is CanonicalSourceInput => row !== null);
      sourceRows.push(...normalized);
    }

    const githubStarsPath = githubStarsCachePath();
    if (await pathExists(githubStarsPath)) {
      const githubStarRecords = await readJsonLines<GitHubStarRecord>(githubStarsPath);
      const normalized = githubStarRecords
        .map(githubStarsSourceFromRecord)
        .filter((row): row is CanonicalSourceInput => row !== null);
      sourceRows.push(...normalized);
    }

    const projectsPath = projectsCachePath();
    if (await pathExists(projectsPath)) {
      const projectRecords = await readJsonLines<ProjectRecord>(projectsPath);
      sourceRows.push(...projectRecords.map(projectSourceFromRecord));
    }

    sourceRows.push(...readYoutubeSourcesFromDb(db));

    const groups = new Map<string, CanonicalSourceInput[]>();
    for (const source of sourceRows) {
      const existing = groups.get(source.dedupeKey) ?? [];
      existing.push(source);
      groups.set(source.dedupeKey, existing);
    }
    const canonicalGroups = [...groups.entries()].map(([dedupeKey, sources]) => buildCanonicalGroup(dedupeKey, sources));

    db.run('BEGIN TRANSACTION');
    try {
      db.run('DELETE FROM bookmark_sources');
      db.run('DELETE FROM canonical_bookmarks');
      const canonicalStmt = db.prepare(INSERT_CANONICAL_SQL);
      const sourceStmt = db.prepare(INSERT_SOURCE_SQL);
      try {
        for (const group of canonicalGroups) {
          canonicalStmt.run(canonicalInsertParams(group, preservedFields.get(group.dedupeKey)));
          const groupSources = groups.get(group.dedupeKey) ?? [];
          for (const source of groupSources) sourceStmt.run(sourceInsertParams(source, group.id));
        }
      } finally {
        canonicalStmt.free();
        sourceStmt.free();
      }
      db.run(`INSERT INTO canonical_bookmarks_fts(canonical_bookmarks_fts) VALUES('rebuild')`);
      db.run('COMMIT');
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }

    saveDb(db, dbPath);
    return { dbPath, sourceCount: sourceRows.length, canonicalCount: canonicalGroups.length };
  } finally {
    db.close();
  }
}

export async function upsertYoutubeVideosAsSources(videos: YoutubeSourceVideoInput[]): Promise<CanonicalRebuildResult> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  const savedAt = new Date().toISOString();

  try {
    initCanonicalSchema(db);
    db.run('BEGIN TRANSACTION');
    try {
      const sourceStmt = db.prepare(INSERT_SOURCE_SQL);
      try {
        for (const video of videos) {
          const source = youtubeSourceFromVideo(video, savedAt);
          db.run(`DELETE FROM bookmark_sources WHERE id = ?`, [source.id]);
          sourceStmt.run(sourceInsertParams(source, canonicalIdForDedupeKey(source.dedupeKey)));
        }
      } finally {
        sourceStmt.free();
      }
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
#!/usr/bin/env node
import { Command, Option } from 'commander';
import { syncTwitterBookmarks } from './bookmarks.js';
import { getBookmarkStatusView, formatBookmarkStatus } from './bookmarks-service.js';
import { runTwitterOAuthFlow } from './xauth.js';
import { syncBookmarksGraphQL, syncGaps, syncBookmarkFolders } from './graphql-bookmarks.js';
import type { SyncProgress, GapFillProgress, FolderSyncProgress } from './graphql-bookmarks.js';
import type { BookmarkFolder, QuotedTweetSnapshot } from './types.js';
import { DEFAULT_MEDIA_MAX_BYTES, fetchBookmarkMediaBatch } from './bookmark-media.js';
import type { MediaFetchManifest, MediaFetchProgress } from './bookmark-media.js';
import {
  buildIndex,
  searchBookmarks,
  formatSearchResults,
  getStats,
  classifyAndRebuild,
  getCategoryCounts,
  sampleByCategory,
  getDomainCounts,
  getFolderCounts,
  listBookmarks,
  getBookmarkById,
} from './bookmarks-db.js';
import {
  classifyCanonicalBookmarks,
  formatCanonicalSearchResults,
  getCanonicalBookmarkById,
  listCanonicalBookmarks,
  rebuildCanonicalIndex,
  searchCanonicalBookmarks,
  upsertYoutubeVideosAsSources,
  type YoutubeSourceVideoInput,
} from './canonical-bookmarks-db.js';
import { formatClassificationSummary } from './bookmark-classify.js';
import { classifyWithLlm, classifyDomainsWithLlm } from './bookmark-classify-llm.js';
import { resolveEngine, detectAvailableEngines } from './engine.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { compileMd } from './md.js';
import { cleanWikiFences } from './md-fence.js';
import { askMd } from './md-ask.js';
import { lintMd, fixLintIssues } from './md-lint.js';
import { exportBookmarks, exportCanonicalBookmarks } from './md-export.js';
import { renderViz } from './bookmarks-viz.js';
import { syncRaindropBookmarks } from './raindrop/sync.js';
import type { SyncRaindropOptions } from './raindrop/sync.js';
import { syncGitHubStars } from './github-stars/sync.js';
import type { SyncGitHubStarsOptions } from './github-stars/sync.js';
import { collectDaily } from './daily/collect.js';
import { connectDailyItems } from './daily/connect.js';
import { enrichThinItems, mergeEnrichmentSummaries } from './daily/enrich.js';
import { synthesizeDaily } from './daily/synthesize.js';
import { writeInterests } from './daily/interests.js';
import { dailyDigestPath } from './daily/paths.js';
import { scanProjects } from './projects/scan.js';
import { collectSessionPrompts } from './projects/sessions.js';
import { getProjectsStatus, syncProjects } from './projects/sync.js';
import { projectsActiveMarkdownPath, projectsCachePath } from './projects/paths.js';
import { createOpenRouterClient } from './llm/openrouter-client.js';
import { createTtsClient, type TtsEngine } from './llm/tts-client.js';
import { processVideo, type OverviewMode } from './youtube/overview.js';
import { resolvePlaylist } from './youtube/playlist.js';
import { writeYoutubeIndexFromState, writeYoutubePlaylistIndex } from './youtube/index-html.js';
import { createEngineYoutubeLlmClient, createFallbackYoutubeLlmClient, type YoutubeLlmClient } from './youtube/llm.js';
import { markPlaylistSynced, updateYoutubeState } from './youtube/state.js';
import type { YtDlpAccessOptions } from './youtube/yt-dlp.js';
import { fetchXListDigest } from './x-list-fetch.js';
import { renderXListHtml } from './x-list-html.js';
import { syncFollowing } from './following/sync.js';
import { searchFollowing, listFollowing, showFollowing, getFollowingStats, getFollowingStatus } from './following/db.js';
import { classifyFollowingWithLlm, classifyFollowingRegexAll } from './following/classify.js';
import { ensureFollowingDir, followingDir } from './following/paths.js';
import type { FollowingSyncProgress } from './following/types.js';
import { listBrowserIds } from './browsers.js';
import { configureHttpProxyFromEnv } from './http-proxy.js';
import { dataDir, ensureDataDir, ensureXListsDir, isFirstRun, migrateLegacyIdeasData, twitterBookmarksIndexPath, twitterBackfillStatePath, mdDir, bookmarkMediaDir, bookmarkMediaManifestPath } from './paths.js';
import { PromptCancelledError, promptText } from './prompt.js';
import { skillWithFrontmatter, installSkill, uninstallSkill } from './skill.js';
import { registerCompanionCommands } from './companion-cli.js';
import { getPathReport } from './field-status.js';
import { runBookmarkWebServer } from './web/server.js';
import { formatResearchResult, researchLocalContext } from './research.js';
import { formatSyncAllResult, runSyncAll } from './sync-all.js';
import {
  formatIdeasIntro,
  formatRunList,
  formatRunSummary,
  getIdeaPrompt,
  listIdeaRuns,
  renderRunDots,
  renderRunGrid,
      if (options.classify) {
        const classifyResult = await classifyCanonicalBookmarks();
        console.log(`  ✓ Classified ${classifyResult.classified}/${classifyResult.total} bookmarks`);
      }
    }));

  // ── sync-github-stars ──────────────────────────────────────────────────

  program
    .command('sync-github-stars')
    .description('Sync GitHub starred repositories into the canonical bookmark index')
    .option('--rebuild', 'Ignore the incremental checkpoint and refetch all current stars')
    .option('--dry-run', 'Fetch and report without writing cache files or rebuilding the canonical index')
    .option('--limit <n>', 'Max repositories to fetch (useful for testing)', (v: string) => Number(v))
    .option('--classify', 'Run regex classification after rebuilding the canonical index')
    .action(safe(async (options) => {
      ensureDataDir();

      const syncOptions: SyncGitHubStarsOptions = {
        rebuild: Boolean(options.rebuild),
        dryRun: Boolean(options.dryRun),
        limit: typeof options.limit === 'number' && Number.isFinite(options.limit) ? options.limit : undefined,
      };

      const result = await syncGitHubStars(syncOptions);

      console.log(`  GitHub Stars sync complete:`);
      console.log(`    fetched: ${result.fetched}`);
      console.log(`    added: ${result.added}`);
      console.log(`    updated: ${result.updated}`);
      if (result.skipped > 0) console.log(`    ⚠ skipped (malformed/missing repo URL): ${result.skipped}`);
      console.log(`    total: ${result.total}`);
      if (result.newestStarredAt) console.log(`    newest starred_at: ${result.newestStarredAt}`);
      console.log(`    data: ${result.cachePath}`);

      if (options.dryRun) {
        console.log(`    Canonical index not rebuilt (dry run)`);
        return;
      }

      await rebuildCanonicalIndex();
      console.log(`  ✓ Canonical index rebuilt`);

      if (options.classify) {
        const classifyResult = await classifyCanonicalBookmarks();
        console.log(`  ✓ Classified ${classifyResult.classified}/${classifyResult.total} bookmarks`);
      }
    }));

  // ── daily ─────────────────────────────────────────────────────────────

  program
    .command('daily')
    .description('Collect what was saved today across all sources and connect it to older items')
    .option('--date <date>', 'Digest a specific UTC day (YYYY-MM-DD) instead of the rolling window')
    .option('--window-hours <n>', 'Rolling window size in hours when no watermark exists', (v: string) => Number(v), 24)
    .option('--write', 'Synthesize the digest markdown and advance the watermark', false)
    .option('--force', 'Overwrite an existing digest for the same date', false)
    .option('--engine <engine>', 'LLM engine for digest synthesis (claude, codex, droid)')
    .option('--model <model>', 'Model override for digest synthesis')
    .option('--effort <effort>', 'Effort override for digest synthesis')
    .option('--json', 'JSON output')
    .action(safe(async (options) => {
      ensureDataDir();
      const collection = await collectDaily({
        date: stringOption(options.date),
        windowHours: typeof options.windowHours === 'number' && Number.isFinite(options.windowHours) ? options.windowHours : 24,
      });
      const enrichment = await enrichThinItems(collection.items, {
        onMissingKey: () => console.error('  Link enrichment skipped: OPENCODE_GO_API_KEY or OPENCODE_API_KEY is not set.'),
      });
      mergeEnrichmentSummaries(collection.items, enrichment.summaries);
      const connected = await connectDailyItems(collection);

      if (options.write) {
        const digestPath = dailyDigestPath(collection.date);
        if (fs.existsSync(digestPath) && !options.force) {
          console.log(`  Digest already exists for ${collection.date}: ${digestPath}`);
          console.log('  Re-run with --force to regenerate.');
          return;
        }
        // FT_DAILY_* env fallbacks let unattended jobs (launchd) pin a cheap
        // engine without baking flags into the sync-all step list.
        const result = await synthesizeDaily(collection, connected, {
          enrichedCount: enrichment.enrichedCount,
          enrichedItemIds: collection.items.filter((item) => item.canonicalUrl && enrichment.summaries.has(item.canonicalUrl)).map((item) => item.id),
          profile: {
            engine: stringOption(options.engine) ?? stringOption(process.env.FT_DAILY_ENGINE),
            model: stringOption(options.model) ?? stringOption(process.env.FT_DAILY_MODEL),
            effort: stringOption(options.effort) ?? stringOption(process.env.FT_DAILY_EFFORT),
          },
        });
        if (result.skipped) {
          console.log(`  Nothing new in this window — no digest written.`);
          return;
        }
        console.log(`  ✓ Digest written: ${result.digestPath}`);
        console.log(`    themes: ${result.themes.length} (${result.usedLlm ? 'llm' : 'mechanical'})`);
        if (result.enrichedCount > 0) console.log(`    enriched links available: ${result.enrichedCount}`);
        if (result.droppedCitations > 0) console.log(`    dropped invalid citations: ${result.droppedCitations}`);
        const interests = await writeInterests();
        console.log(`  ✓ Interests updated: ${interests.path}`);
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({
          date: collection.date,
          sinceIso: collection.sinceIso,
          untilIso: collection.untilIso,
          items: connected.map(({ item, related }) => ({ ...item, related })),
          projectDeltas: collection.projectDeltas,
        }, null, 2));
        return;
      }

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { compareVersions, runWithSpinner, buildCli, parseCookieOption, shouldDownloadSyncMedia } from '../src/cli.js';
import { dataDir } from '../src/paths.js';
import { skillWithFrontmatter } from '../src/skill.js';
import { rebuildCanonicalIndex } from '../src/canonical-bookmarks-db.js';

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origWrite = process.stdout.write;
  process.stdout.write = ((chunk: any, encodingOrCb?: any, cb?: any) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf-8') : String(chunk));
    if (typeof encodingOrCb === 'function') encodingOrCb();
    if (typeof cb === 'function') cb();
    return true;
  }) as typeof process.stdout.write;

  try {
    await fn();
  } finally {
    process.stdout.write = origWrite;
  }

  return chunks.join('');
}

async function captureConsoleErrors(fn: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const origError = console.error;
  console.error = (...args: any[]) => { chunks.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.error = origError;
  }
  return chunks.join('\n');
}

test('showDashboard: prints update notice when cache is newer than local', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-dashboard-'));
  const origEnv = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = tmpDir;

  // Fresh cache file with an absurdly high version — exercises the cache-hit
  // path (no network), and guarantees the notice regardless of local version.
  fs.writeFileSync(path.join(tmpDir, '.update-check'), '99.99.99');

  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...args: any[]) => { logs.push(args.map(String).join(' ')); };

  try {
    const { showDashboard } = await import('../src/cli.js');
    await showDashboard();
  } finally {
    console.log = origLog;
    process.env.FT_DATA_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  const joined = logs.join('\n');
  assert.ok(
    joined.includes('Update available') && joined.includes('99.99.99'),
    `expected update notice mentioning the cached 99.99.99 version; got:\n${joined}`,
  );
});

test('ft wiki: --engine option is registered', () => {
  const program = buildCli();
  const wikiCmd = program.commands.find((c: any) => c.name() === 'wiki');
  assert.ok(wikiCmd, 'wiki command should be registered');
  const opts = wikiCmd.options.map((o: any) => o.long);
  assert.ok(opts.includes('--engine'), `expected --engine among ${opts.join(', ')}`);
});

test('ft search, stats, and status expose --json', () => {
  const program = buildCli();
  for (const name of ['search', 'stats', 'status']) {
    const cmd = program.commands.find((c: any) => c.name() === name);
    assert.ok(cmd, `${name} command should be registered`);
    const opts = cmd.options.map((o: any) => o.long);
    assert.ok(opts.includes('--json'), `expected --json on ft ${name}`);
  }
});

test('ft paths, library, commands, app, and install command groups are registered', () => {
  const program = buildCli();
  for (const name of ['paths', 'library', 'commands', 'app', 'install']) {
    assert.ok(program.commands.find((c: any) => c.name() === name), `${name} command should be registered`);
  }
});

test('ft install app command is registered', () => {
  const program = buildCli();
  const installCmd = program.commands.find((c: any) => c.name() === 'install');
  assert.ok(installCmd, 'install command should be registered');
  const appCmd = installCmd.commands.find((c: any) => c.name() === 'app');
  assert.ok(appCmd, 'install app command should be registered');
  const opts = appCmd.options.map((o: any) => o.long);
  assert.ok(opts.includes('--install-dir'));
  assert.ok(opts.includes('--open'));
  assert.ok(opts.includes('--json'));
});

test('ft sync: media is off by default and exposes --media opt-in', () => {
  const program = buildCli();
  const syncCmd = program.commands.find((c: any) => c.name() === 'sync');
      starRecord({ id: 2, fullName: 'thin/two', starredAt: '2026-07-06T13:00:00.000Z' }),
    ]);
    await rebuildCanonicalIndex();

    const collection = await collectDaily({ date: '2026-07-06' });
    for (const item of collection.items) item.searchText = `${item.canonicalUrl} brief share`;
    let invoked = false;
    const result = await synthesizeDaily(collection, [], { invoke: async () => { invoked = true; return '[]'; } });

    assert.equal(invoked, false);
    assert.equal(result.usedLlm, false);
    assert.equal(result.themes.length, 0);
    assert.equal(result.thinSkipped, 2);
    assert.equal(result.alsoSavedCount, 2);
  });
});

test('daily: enriches a thin link into the prompt and reuses its durable cache', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [starRecord({ id: 75, fullName: 'a/enriched-link', starredAt: '2026-07-06T12:00:00.000Z', description: 'brief' })]);
    await rebuildCanonicalIndex();
    const collection = await collectDaily({ date: '2026-07-06' });
    const item = collection.items[0];
    item.searchText = `${item.canonicalUrl} brief`;
    let fetchCalls = 0;
    const enrichment = await enrichThinItems(collection.items, {
      fetch: async () => {
        fetchCalls += 1;
        return new Response('<html><title>Enriched page</title><meta name="description" content="A useful page."><body>Detailed article material for the digest.</body></html>');
      },
      llm: async () => 'This page explains a useful implementation technique with practical context.',
    });
    mergeEnrichmentSummaries(collection.items, enrichment.summaries);
    assert.equal(enrichment.enrichedCount, 1);
    assert.match(item.searchText, /summary: This page explains/);
    let prompt = '';
    const result = await synthesizeDaily(collection, await connectDailyItems(collection), {
      enrichedCount: enrichment.enrichedCount,
      enrichedItemIds: [item.id],
      invoke: async (value) => {
        prompt = value;
        return '[{"title":"Useful technique","summary":"A connected implementation idea.","itemIds":["i1"],"relatedIds":[],"projects":[]}]';
      },
    });
    assert.equal(result.usedLlm, true);
    assert.match(prompt, /enriched-link/);
    assert.equal(fetchCalls, 1);

    await rebuildCanonicalIndex();
    const cached = await enrichThinItems(collection.items, {
      fetch: async () => { throw new Error('cache miss'); },
      llm: async () => { throw new Error('cache miss'); },
    });
    assert.equal(cached.enrichedCount, 1);
  });
});

test('daily: empty enrichment completion is cached as failed and leaves the item thin', async () => {
  await withIsolatedDataDir(async (dir) => {
    await writeStars(dir, [starRecord({ id: 76, fullName: 'a/empty-enrichment', starredAt: '2026-07-06T12:00:00.000Z', description: 'brief' })]);
    await rebuildCanonicalIndex();
    const collection = await collectDaily({ date: '2026-07-06' });
    collection.items[0].searchText = `${collection.items[0].canonicalUrl} brief`;
    const enrichment = await enrichThinItems(collection.items, {
      fetch: async () => new Response('<title>Page</title><body>body</body>'),
      llm: async () => '',
    });
    mergeEnrichmentSummaries(collection.items, enrichment.summaries);
    assert.equal(enrichment.enrichedCount, 0);
    assert.ok(contentLength(collection.items[0].searchText) < 120);
    const result = await synthesizeDaily(collection, [], { invoke: async () => { throw new Error('should not invoke'); } });
    assert.equal(result.thinSkipped, 1);
    assert.match(await readFileText(result.digestPath), /Also saved/);
  });
});

test('daily: enrichment silently no-ops without an OpenCode key', async () => {
  const previousGo = process.env.OPENCODE_GO_API_KEY;
  const previousApi = process.env.OPENCODE_API_KEY;
  delete process.env.OPENCODE_GO_API_KEY;
  delete process.env.OPENCODE_API_KEY;
  try {
    const result = await enrichThinItems([{ id: 'thin', canonicalUrl: 'https://example.com/thin', displayTitle: 'thin', searchText: 'https://example.com/thin', sources: [], firstSavedAt: null, lastSavedAt: null, primaryCategory: null, primaryDomain: null }]);
    assert.equal(result.enrichedCount, 0);
  } finally {
    if (previousGo === undefined) delete process.env.OPENCODE_GO_API_KEY;
    else process.env.OPENCODE_GO_API_KEY = previousGo;
    if (previousApi === undefined) delete process.env.OPENCODE_API_KEY;
    else process.env.OPENCODE_API_KEY = previousApi;
  }
});

test('daily: enrichment never fetches private IPs or redirects to them', async () => {
  await withIsolatedDataDir(async () => {
    const thin = (url: string): CanonicalRecentItem => ({ id: url, canonicalUrl: url, displayTitle: url, searchText: url, sources: [], firstSavedAt: null, lastSavedAt: null, primaryCategory: null, primaryDomain: null });
    let fetchCalls = 0;
    const privateResult = await enrichThinItems([thin('http://192.168.1.1/x')], {
      fetch: async () => { fetchCalls += 1; throw new Error('must not fetch'); },
      llm: async () => 'unused',
    });
    assert.equal(privateResult.enrichedCount, 0);
    assert.equal(fetchCalls, 0);

    const redirectResult = await enrichThinItems([thin('https://example.com/redirect')], {
      fetch: async () => {
        fetchCalls += 1;
        return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/internal' } });
      },
      llm: async () => 'unused',
    });
    assert.equal(redirectResult.enrichedCount, 0);
    assert.equal(fetchCalls, 1);
  });
});

test('daily: an OpenCode timeout records a failed enrichment without hanging', async () => {
  await withIsolatedDataDir(async () => {
    const item: CanonicalRecentItem = { id: 'timeout', canonicalUrl: 'https://example.com/timeout', displayTitle: 'timeout', searchText: 'https://example.com/timeout', sources: [], firstSavedAt: null, lastSavedAt: null, primaryCategory: null, primaryDomain: null };
    const { createOpenCodeClient } = await import('../src/llm/opencode-client.js');
    const client = createOpenCodeClient({ apiKey: 'test-key', timeoutMs: 5, fetch: async () => new Promise<Response>(() => {}) });
    const result = await enrichThinItems([item], {
      fetch: async () => new Response('<title>Page</title><body>body</body>'),
      llm: async (prompt) => (await client.chat({ prompt })).text,
    });
    assert.equal(result.enrichedCount, 0);

    let retried = false;
    const cachedFailure = await enrichThinItems([item], {
      fetch: async () => { retried = true; throw new Error('should remain cached failed'); },
      llm: async () => { retried = true; return 'should not run'; },
    });
    assert.equal(cachedFailure.enrichedCount, 0);
    assert.equal(retried, false);
  });
});

test('daily: interests classifies rising/steady/fading topics and finds active threads', async () => {
  await withIsolatedDataDir(async (dir) => {
    const now = new Date('2026-07-07T00:00:00.000Z');
    const recent = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
    // Rising: 3 "agents"-category saves this week, none in baseline.
    // Fading: 5 "css" saves in baseline, none this week.
    await writeStars(dir, [
      starRecord({ id: 1, fullName: 'a/agent-one', starredAt: recent(1), description: 'llm agents orchestration framework' }),
      starRecord({ id: 2, fullName: 'b/agent-two', starredAt: recent(2), description: 'llm agents memory framework' }),
      starRecord({ id: 3, fullName: 'c/agent-three', starredAt: recent(3), description: 'llm agents evaluation framework' }),
      ...Array.from({ length: 5 }, (_, i) => starRecord({
        id: 10 + i,
        fullName: `css/lib-${i}`,
        starredAt: recent(10 + i),
        description: 'css styling toolkit',

ERROR: Selected model is at capacity. Please try a different model.
ERROR: Selected model is at capacity. Please try a different model.
tokens used
24,734


## Next action

Inspect stderr and worker output; retry with adjusted prompt or harness.

## Artifacts

- run_dir: /Users/manik/Github/fieldtheory-cli/.harness/runs/codex-20260710T191314Z-j49nec
- receipt: /Users/manik/Github/fieldtheory-cli/.harness/runs/codex-20260710T191314Z-j49nec/receipt.json
- input: /Users/manik/Github/fieldtheory-cli/.harness/runs/codex-20260710T191314Z-j49nec/input.md
- prompt: /Users/manik/Github/fieldtheory-cli/.harness/runs/codex-20260710T191314Z-j49nec/prompt.md
- route: /Users/manik/Github/fieldtheory-cli/.harness/runs/codex-20260710T191314Z-j49nec/route.json
- command: /Users/manik/Github/fieldtheory-cli/.harness/runs/codex-20260710T191314Z-j49nec/command.json
- events: /Users/manik/Github/fieldtheory-cli/.harness/runs/codex-20260710T191314Z-j49nec/events.jsonl
- stdout: /Users/manik/Github/fieldtheory-cli/.harness/runs/codex-20260710T191314Z-j49nec/stdout.log
- stderr: /Users/manik/Github/fieldtheory-cli/.harness/runs/codex-20260710T191314Z-j49nec/stderr.log
- result: /Users/manik/Github/fieldtheory-cli/.harness/runs/codex-20260710T191314Z-j49nec/result.json
