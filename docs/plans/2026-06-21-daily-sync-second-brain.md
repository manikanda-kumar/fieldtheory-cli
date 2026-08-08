# Plan: Daily Sync + Agent-Ready Second Brain

**Date:** 2026-06-21
**Status:** Approved scope — pending implementation
**Goal:** (A) Sync all 6 data sources daily, unattended. (B) Synthesize them into a unified knowledge base that both the user and AI agents can review and query for research.

---

## 1. Context & Current State

Field Theory CLI already has the building blocks. This plan wires them together; it is mostly integration, not greenfield.

### 1.1 The 6 sources

| Source | Command | Auth | Locality | Heavy? |
|--------|---------|------|----------|--------|
| X/Twitter bookmarks | `ft sync` | Chrome cookies (Keychain) | **Local only** | No |
| X following roster | `ft sync-following` | Chrome cookies (`twid`) | **Local only** | No |
| X list digest | `ft x-list <id>` | Chrome cookies | **Local only** | No |
| Raindrop.io | `ft sync-raindrop` | `RAINDROP_TOKEN` | Headless | No |
| GitHub stars | `ft sync-github-stars` | `gh` CLI / `GITHUB_TOKEN` | Headless | No |
| YouTube playlist | `ft sync-youtube --playlist <url>` | `OPENROUTER_API_KEY` + `yt-dlp` (+ `ffmpeg`) | Local (cookie paths) | **Yes — LLM/$ + slow** |

### 1.2 Locality verdict

3 of 6 sources require live Chrome session cookies on this Mac → **the whole daily job must run locally via launchd**. No cloud/headless option for the full set.

### 1.3 Freshness audit (2026-06-21)

- `x-list` — daily launchd job working (outputs Jun 19/20/21).
- GitHub stars — Jun 15 (manual).
- X bookmarks — Jun 14.
- YouTube — Jun 14.
- **Raindrop — never synced** (`~/.fieldtheory/bookmarks/raindrop/bookmarks.jsonl` absent).
- Following — new feature.

Conclusion: daily sync is **not happening** except x-list.

### 1.4 Synthesis / query surface that exists

- `ft md --canonical` — unified markdown export across all sources.
- `ft wiki` — Karpathy-style page compile (needs `claude`/`codex` CLI on PATH).
- `ft ask <q> [--json] [--save]` — LLM Q&A over the markdown wiki.
- `ft index` — rebuild SQLite search index.
- `ft search --unified`, `ft list --unified --source`, `ft show --unified`, `ft status --json`, `ft library search/list/show --json`.
- Canonical SQLite (`bookmarks.db`): `bookmark_sources`, `canonical_bookmarks`, `canonical_bookmarks_fts` (FTS5/BM25). Standard SQLite — `sqlite3` CLI works directly.

### 1.5 Core gap

`ft wiki` and `ft ask` source from the **legacy X-only** `bookmarks-db.ts` (`searchBookmarks`), **not** the unified canonical index. So the "brain" answers from X bookmarks only — blind to Raindrop, GitHub stars, YouTube, following. This defeats the second-brain goal.

Full 10-gap inventory lives in `CONTINUITY.md` (Second-brain query surface audit). This plan closes the subset selected below.

---

## 2. Decisions (locked 2026-06-21)

| Decision | Choice |
|----------|--------|
| YouTube cadence | **Daily, capped** via `--limit` (cost/time bounded) |
| Build scope | **Sync + agent-ready query** (daily job + GAP-2 unified ask + GAP-9 research command + sqlite3 docs) |
| Agent access modes | **All three**: direct `sqlite3`, `ft research/ask --json`, grep markdown library |

**In scope:** daily sync orchestration, unified `ft ask`, `ft research` aggregator, agent research doc.
**Deferred:** GAP-3 x-list canonical ingest, GAP-5 full-YouTube-text in FTS, GAP-6 unified wiki pages, GAP-4 `--json` on `categories/domains/folders`.

---

## 3. Phase 1 — Daily Sync (one local job)

### 3.1 New command: `ft sync-all`

Single orchestrator. Runs each source **sequentially**, **fault-isolated** (one source failing logs + continues; never aborts the batch), with per-source timing + result lines.

Order (cheap/local-cookie first, heavy last):

```
ft sync-following                         # Chrome
ft sync                                   # X bookmarks, Chrome
ft x-list <listId> --since-hours 24       # Chrome
ft sync-raindrop --classify               # RAINDROP_TOKEN
ft sync-github-stars --classify           # gh / GITHUB_TOKEN
ft sync-youtube --playlist <url> --limit <N>   # OpenRouter $, capped
ft index                                  # rebuild SQLite canonical index
ft md --canonical                         # refresh markdown library
ft wiki                                   # recompile wiki pages (claude/codex)
```

**Flags:**
- `--skip <source[,source]>` — e.g. `--skip youtube`.
- `--only <source[,source]>` — run a subset.
- `--no-synthesis` — sync sources but skip `index`/`md`/`wiki` tail.
- `--youtube-limit <N>` — cap new videos (default 8).
- `--dry-run` — print plan + preflight results, run nothing.
- `--playlist <url>` and `--x-list <id>` — or read from config (see 3.3).

### 3.2 Preflight gate

Before running, check each source's prerequisite and **skip-with-warning** if missing (never crash the batch):
- env tokens: `RAINDROP_TOKEN`, `GITHUB_TOKEN`/`GH_TOKEN` (or `gh auth status`), `OPENROUTER_API_KEY`.
- binaries: `yt-dlp`, `ffmpeg` (YouTube only), `claude`/`codex` (wiki only).
- Chrome cookie availability for the local-cookie sources.

`ft sync-all --dry-run` prints the preflight matrix so setup gaps are visible before scheduling.

**Token setup:** none found in `.env` today. First implementation step adds/ documents a `.env` at repo root or `~/.fieldtheory/.env` (dotenv already loads both). Secrets stay out of git.

### 3.3 Config

Persist the playlist URL + x-list id so the cron wrapper has no hardcoded args. Options:
- reuse `src/preferences.ts` (preferred), or
- a small `~/.fieldtheory/sync-all.json`.

### 3.4 Scheduling (launchd, local)

- Wrapper: `~/.fieldtheory/sync-all.sh` (mirrors existing `x-lists/run-daily.sh`: sets PATH, calls `ft sync-all`, appends to log).
- Plist: `~/Library/LaunchAgents/dev.fieldtheory.sync-all-daily.plist`, `StartCalendarInterval` (e.g. 09:00).
- Log: `~/.fieldtheory/sync-all.log` + `launchd.out/err.log`.
- **Retire** standalone `dev.fieldtheory.xlist-daily.plist` (x-list now folded into `sync-all`) — unload + remove to avoid double-fetch.
- Optionally generalize `src/ideas-nightly.ts` plist builder (`buildLaunchAgentPlist`, already produces `StartCalendarInterval` plists) into a shared installer, exposed as `ft sync-all install` / `uninstall` — nice-to-have, not required for v1.

### 3.5 Idempotency / safety

All sources already incremental (cutoff/cursor/contentHash). `ft index` + `ft md --canonical` rebuild deterministically. Safe to re-run daily. YouTube cap bounds cost on busy playlists.

---

## 4. Phase 2 — Agent-Ready Query Layer

Three access modes (per decision), in increasing code cost.

### 4.1 Direct sqlite3 (GAP-10) — zero code

`bookmarks.db` is standard SQLite. Most precise interface; document it:

```bash
sqlite3 ~/.fieldtheory/bookmarks/bookmarks.db \
  "SELECT display_title, canonical_url, primary_category, source_count
   FROM canonical_bookmarks
   WHERE canonical_bookmarks_fts MATCH 'agents'
   ORDER BY last_saved_at DESC LIMIT 20"
```

### 4.2 Fix `ft ask` → unified (GAP-2)

`src/md-ask.ts` L3 grounding calls X-only `searchBookmarks()`. Add a parallel `searchCanonicalBookmarks()` call and merge results (dedupe by canonical id/url) so `ft ask` reasons across all 6 sources. Keep L1 (`index.md`) + L2 (category/domain/entity pages) as-is. Small, high value.

### 4.3 New command: `ft research <topic> [--json] [--limit N]` (GAP-9)

One-shot aggregator an agent calls first. Fans out and returns ranked, cited hits:
- canonical FTS (`searchCanonicalBookmarks`) — all sources.
- library markdown grep (`ft library search`) — full-text incl. YouTube chapters.
- YouTube notes/state lookup — topic match over `state.json` topics.
- experts (following) match — relevant accounts for the topic.

Output (`--json`): array of `{ source, title, url, snippet, mdPath, score, savedAt }` grouped by source, plus a `paths` block pointing at the markdown files to read for deep context. Human mode: grouped, readable summary.

### 4.4 Agent research contract doc

`docs/AGENTS-research.md` (+ pointer line in `CLAUDE.md`). Tells any agent (and future me) the entrypoint:

1. `ft research "<topic>" --json` — broad ranked fan-out (start here).
2. `sqlite3 bookmarks.db "... MATCH '<topic>' ..."` — precise/custom queries.
3. Read returned `~/.fieldtheory/library/**/*.md` — full context (frontmatter + wikilinks).
4. `ft ask "<question>"` — synthesized answer with sources.

Documents the canonical schema, FTS syntax, source filters, and md frontmatter fields so an agent can self-serve.

---

## 5. Build Order

1. **Token/.env setup** + `ft sync-all` skeleton + preflight + `--dry-run`. Verify preflight matrix.
2. **Wire all sources** into `ft sync-all` (sequential, fault-isolated, logged) + synthesis tail. Verify one clean end-to-end run.
3. **launchd**: wrapper + plist, retire x-list plist. Confirm scheduled fire.
4. **`ft ask` unified** (GAP-2) + tests.
5. **`ft research --json`** aggregator (GAP-9) + tests.
6. **`docs/AGENTS-research.md`** + `CLAUDE.md` pointer.

Each step: `npm run build` clean + focused tests (`npx tsx --test <file>`) + commit (no attribution trailer).

---

## 6. Verification / Success Criteria

- `ft sync-all --dry-run` prints accurate preflight for all 6 sources.
- One real `ft sync-all` run updates all available sources, rebuilds index + markdown + wiki, and survives a single-source failure.
- launchd job fires daily; `sync-all.log` shows per-source results.
- `ft ask "<topic>"` cites Raindrop/GitHub/YouTube hits, not just X.
- `ft research "<topic>" --json` returns cross-source ranked results with md paths.
- An agent, given `docs/AGENTS-research.md` only, can answer a research question end-to-end.

---

## 7. Open Items / Inputs Needed

- **YouTube playlist URL/id** to wire into the daily job.
- **Token confirmation**: `RAINDROP_TOKEN`, `GITHUB_TOKEN` (or `gh` logged in), `OPENROUTER_API_KEY` — present or add `.env` setup step first.
- Daily run **time** (default 09:00) and YouTube **per-run cap** (default 8).

---

## 8. Deferred (tracked, not in this plan)

- GAP-3: ingest `x-lists/*.json` into canonical index.
- GAP-5: full YouTube chapter text into canonical FTS.
- GAP-6: unified cross-source wiki pages (`ft wiki --unified`).
- GAP-4: `--json` on `ft categories/domains/folders`.
- GAP-7: `ft wiki --json` manifest output.
