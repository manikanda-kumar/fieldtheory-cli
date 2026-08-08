# Plan: Companion Agent — Projects Source, Daily Synthesis, Proactive Recall

**Date:** 2026-07-07
**Status:** Draft — pending approval
**Builds on:** `docs/plans/2026-06-21-daily-sync-second-brain.md` (Layer 1: `ft sync-all` — implemented; unified `ft ask` + `ft research` — implemented)

**Goal:** An agent that (1) knows what I'm working on and where I am on each project, (2) synthesizes everything I consume daily and connects it to past consumption and active work, and (3) proactively recalls during any project/research session: "we studied that last week", "discussed in yesterday's YouTube video", "hot topic on X right now", "blog had gotchas on this".

---

## 1. Context & Current State

### 1.1 What exists (the substrate)

- **6 consumption sources** synced via `ft sync-all`: X bookmarks (10k+), YouTube playlist notes (419+), Raindrop, GitHub stars (2.3k), X following/experts, X list digests.
- **Canonical SQLite FTS** (`canonical_bookmarks` + FTS5, deduped by URL) — standard SQLite, direct `sqlite3` works.
- **Markdown library** at `~/.fieldtheory/library/` — per-bookmark md, YouTube notes, category/domain/entity wiki pages.
- **Query surfaces:** `ft research <topic> --json` (cross-source fan-out), `ft ask` (unified LLM Q&A), `ft search/list/show --unified --json`.

### 1.2 Work-context ground truth (verified 2026-07-07, no new dumps needed)

| Signal | Location | Content |
|--------|----------|---------|
| Projects | `~/Github/*` — 248 repos (depth-1) | git status/log = pending work, activity |
| Project state | `CONTINUITY.md` in 51 repos | Goal / Now / Next per project (existing convention) |
| Claude Code sessions | `~/.claude/projects/<path-encoded-dir>/*.jsonl` — 73 dirs | every user prompt, per repo |
| Codex sessions | `~/.codex/sessions/<year>/...` | same, Codex |
| OpenCode sessions | `~/.local/share/opencode/opencode.db` | same, SQLite |

The `github-sessions` and `agent-sessions` macOS apps are read-only viewers over exactly these locations — we ingest from the ground truth, not the apps. Format references: `~/Github/agent-sessions/docs/guides/*.html` documents every agent's log format.

### 1.3 The three missing layers

1. **Projects source** — nothing tells the knowledge base what I'm building or where I am.
2. **Daily synthesis** — new items are indexed but never digested, cross-linked to past items, or joined to active projects. No interest/trend model.
3. **Recall surface** — retrieval is pull-only (`ft research` when asked). Nothing ambient injects "we saw this last week" into agent sessions on other projects.

---

## 2. Architecture

```
Layer 1 (exists)  ft sync-all nightly → canonical db + library md
Layer 2 (Phase A) ft sync-projects   → library/projects/*.md + projects-active.md
Layer 3 (Phase B) ft daily           → library/daily/YYYY-MM-DD.md + interests.md
Layer 4 (Phase C) recall skill       → global Claude Code skill reading 2+3 outputs
```

Design principles:

- **Markdown outputs, not just db.** Digests/profiles are what agents (and I) read. Grep-able, wikilink-able, survives everything.
- **No new daemon, no vector db.** FTS5 + `ft research` + small always-loadable context files gets 80% of recall. Embeddings = deferred upgrade if FTS proves too literal.
- **Privacy:** session prompts contain everything typed to agents. Synthesis runs through the existing engine chain (droid/deepseek local-ish, OpenRouter) — same trust boundary as YouTube notes. Nothing leaves beyond the LLM call already trusted for other sources. `--redact` deferred.

---

## 3. Phase A — `ft sync-projects` (7th source)

### 3.1 New module `src/projects/`

Mirror the `src/following/` module pattern (types, paths, scan, db, sync):

- `types.ts` — `ProjectRecord { repo, path, description, goalNowNext?, lastCommitAt, pendingFiles, unpushedCommits, recentCommits[], sessionActivity? }`, `SessionPrompt { agent, repo, timestamp, text }`.
- `paths.ts` — data at `~/.fieldtheory/bookmarks/projects/` (`projects.jsonl`, `sessions.jsonl`, `meta.json`); library at `~/.fieldtheory/library/projects/`.
- `scan.ts` — repo scanner:
  - Depth-1 dirs under scan root (default `~/Github`, configurable via preferences).
  - Skip: non-git dirs, repos untouched > 90 days (mtime of `.git` HEAD/index — cheap pre-filter before any `git` exec).
  - Per repo: `git log --since=14d --format=%H|%aI|%s` (recent commits), `git status --porcelain` (pending counts), `git rev-list @{u}..HEAD --count` (unpushed; tolerate no-upstream), `CONTINUITY.md` — extract Goal/Now/Next sections only (first ~40 lines per section cap), README first paragraph.
- `sessions.ts` — agent-session prompt extractor, **Claude-only in v1**:
  - Walk `~/.claude/projects/*/*.jsonl`, decode dir name → repo path (`-Users-manik-Github-foo` → `/Users/manik/Github/foo`; note: `-` in dir names is ambiguous with `_`/`-` in repo names — resolve by checking which candidate path exists).
  - Parse lines where `type === "user"`, skip `isSidechain`, skip non-string `message.content` (tool_results), skip content starting with `<system-reminder>`, `<command-`, or caveman-hook noise. Take `timestamp` field (verify presence; fall back to file mtime).
  - Incremental: `meta.json` stores per-file byte offset or mtime cutoff; only parse new/changed files.
  - Codex (`~/.codex/sessions/`) and OpenCode (`opencode.db`) = Phase A.2, after Claude path proves out.
- `sync.ts` — orchestrates scan + sessions → JSONL caches → markdown emit.

### 3.2 Markdown outputs

- `library/projects/<repo>.md` — frontmatter (`repo`, `path`, `last_commit_at`, `pending`, `unpushed`, `updated_at`) + body: description, Goal/Now/Next (verbatim from ledger), recent commit subjects, recent session queries (last 14d, dated).
- `library/projects-active.md` — the rolling brief. Top ~10 repos ranked by `recency-weighted (commits + session prompts)`. One block each: repo, one-line description, Now/Next, last touched. **Hard cap ~120 lines** — this file gets loaded into agent context, must stay cheap.

### 3.3 Canonical index integration

- `projectSourceFromRecord()` in `canonical-bookmarks-db.ts` → `bookmark_sources.source = 'project'`, dedupe key `url:<github repo url>` (merges with GitHub-stars rows when I star my own deps — correct behavior), text = name + description + Goal/Now/Next + recent commit subjects.
- Session prompts are **not** individual canonical rows (too noisy); they contribute to the project row's `search_text` (last 14d, deduped, capped ~4K chars per repo).
- `ft research` then automatically surfaces active-project hits next to bookmarks — no changes needed there beyond the new source label.

### 3.4 CLI

- `ft sync-projects [--rebuild] [--root <path>] [--max-age-days <n>] [--no-sessions] [--dry-run]`.
- Wire into `src/sync-all.ts` as source `projects` (after github-stars, before youtube — cheap, local, no network).
- `ft status --json` gains `projects` block.

---

## 4. Phase B — `ft daily` (synthesis)

### 4.1 New module `src/daily/`

- `collect.ts` — everything new since last run (from `meta.json` watermark, default 24h):
  - canonical rows where `first_saved_at > watermark` (all sources incl. projects),
  - new YouTube notes (state.json `syncedAt`),
  - latest x-list digest JSON,
  - project deltas (new commits, new session prompts).
- `connect.ts` — for each new item, FTS query (top terms from title+text) against canonical index **excluding items from the same day** → top-3 past related items with dates. Pure SQL, no LLM.
- `synthesize.ts` — one LLM call (existing `engine.ts` chain, default droid/deepseek-v4-flash) over the collected + connected material. Prompt contract (hardened via `withSystemOverride` like other prompts):
  - group into 3–7 themes,
  - per theme: what's new, links to related past items (with dates: "saved 2026-06-30"), related active project if any,
  - flag rising topics (appears across ≥2 sources or ≥3 items),
  - flag connections to `projects-active.md` entries explicitly.
- `interests.ts` — updates rolling profile (see 4.3).
- Output: `library/daily/YYYY-MM-DD.md` — frontmatter (`date`, `new_items`, `sources`, `themes[]`) + themed body with wikilinks to library pages and `[[project:<repo>]]` links.

### 4.2 Determinism guard

LLM output validated: every cited item id/url must exist in the collected set (reuse the extractJsonArray-style validation pattern); citations that fail validation are dropped, not hallucinated into the digest. Digest generation is idempotent per date (`--force` to regenerate).

### 4.3 `library/interests.md` — the rolling interest model

Mechanical (SQL) + LLM summary, regenerated each `ft daily` run:

- **Topic velocity:** category/domain counts over trailing 7d vs prior 30d avg → rising / steady / fading lists.
- **Active threads:** topics appearing in BOTH consumption and session prompts in last 7d (the "what I'm struggling with AND reading about" intersection — highest-value signal).
- **Top experts active:** following-roster accounts whose domains match rising topics.
- **Hard cap ~80 lines.** This is the always-loadable context file.

### 4.4 CLI + scheduling

- `ft daily [--date YYYY-MM-DD] [--force] [--dry-run] [--engine/--model ...]`.
- Appended to `ft sync-all` synthesis tail: `index` → `md --canonical` → `daily` (wiki stays optional).
- Runs in the existing/planned `sync-all` launchd job — no new plist.

---

## 5. Phase C — Recall surface (global Claude Code skill)

### 5.1 `~/.claude/skills/second-brain/SKILL.md`

Global skill, triggers on: research questions, new project/feature planning, "have we seen", technology evaluations, library/tool choices — in **any** repo.

Skill instructions (the contract):

1. Read `~/.fieldtheory/library/projects-active.md` + `~/.fieldtheory/library/interests.md` (≤200 lines total — always cheap).
2. `ft research "<topic>" --json` for the task's key terms.
3. If temporal ("yesterday", "last week"): read `~/.fieldtheory/library/daily/<date-range>.md` directly.
4. Surface findings conversationally with dates and sources: "studied X last week (3 bookmarks + video Y on 2026-07-02), gotcha in blog Z, aligns with rising interest in W".
5. Full detail: read the md paths returned by `ft research`.

### 5.2 Repo doc

`docs/AGENTS-recall.md` — same contract for non-Claude agents (Codex, etc.), pointer from `CLAUDE.md`. Extends the existing `docs/AGENTS-research.md` pattern with the new files (daily digests, interests, projects-active).

---

## 6. Build Order

| # | Step | Verify |
|---|------|--------|
| 1 | `src/projects/` scan + ledger extraction + `library/projects/*.md` + `projects-active.md` | scan of `~/Github` finds 248 repos, ~51 ledgers parsed; active list sane; `npm run build` + tests |
| 2 | Claude session prompt extraction (incremental) into project records | prompts from this repo's 209 JSONL files extracted, noise filtered, dates correct |
| 3 | Canonical integration (`source='project'`) + `ft sync-projects` CLI + sync-all wiring | `ft research "fieldtheory"` returns project row; `ft list --unified --source project` works |
| 4 | `ft daily` collect + connect (SQL only, no LLM) with `--dry-run` output | dry-run lists new items + past-item links with dates |
| 5 | `ft daily` synthesize + digest md + citation validation | real digest for today reads well; all citations resolve |
| 6 | `interests.md` generation | velocity lists match manual SQL spot-check; ≤80 lines |
| 7 | sync-all tail wiring + one full end-to-end nightly run | `ft sync-all` produces digest; single-source failure doesn't kill digest |
| 8 | `second-brain` skill + `docs/AGENTS-recall.md` | in a *different* repo session, skill surfaces relevant recall unprompted |
| 9 | (A.2, optional) Codex + OpenCode session extraction | prompts from both appear in project records |

Each step: `npm run build` clean, focused tests via `npx tsx --test <file>`, commit without attribution trailer.

---

## 7. Success Criteria

- `ft sync-projects` runs in < 30s over 248 repos (mtime pre-filter working).
- `projects-active.md` correctly names what I worked on this week without manual input.
- Daily digest connects ≥1 new item to a past item or active project on a normal day, with valid dated citations.
- `interests.md` rising-topics list matches intuition ("yes, that IS what I'm into right now").
- In a fresh session on an unrelated repo, asking a research question triggers recall citing specific past bookmarks/videos with dates.

---

## 8. Deferred

- Codex/OpenCode session ingestion (A.2) — after Claude path proves out.
- Embeddings/semantic recall — only if FTS recall proves too literal in practice.
- `--redact` filter for session prompts before LLM synthesis.
- Weekly/monthly rollup digests (`ft daily --week`).
- x-list canonical ingest (GAP-3) — still deferred from prior plan.
- Push notifications / morning-brief delivery.

---

## 9. Open Items / Inputs Needed

- Scan root confirm: `~/Github` only, or additional roots?
- Session-prompt retention window in project md (default 14d) and in canonical search_text (default 14d, 4K cap) — OK?
- Digest LLM engine/model default: droid + deepseek-v4-flash (same as YouTube notes) — OK?
- Verify Claude JSONL `timestamp` field present on user lines (spot-check said schema varies by line type).
