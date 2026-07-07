# Agent Recall Contract — Field Theory Second Brain

How any coding agent (Claude Code, Codex, Droid, OpenCode, ...) should recall from the user's knowledge base. All data is local under `~/.fieldtheory/`.

## What exists

| Artifact | Path | Refreshed by |
|----------|------|--------------|
| Interests profile (≤80 lines) | `~/.fieldtheory/library/interests.md` | `ft daily --write` |
| Active projects brief (≤120 lines) | `~/.fieldtheory/library/projects-active.md` | `ft sync-projects` |
| Daily digests (themes + citations) | `~/.fieldtheory/library/daily/YYYY-MM-DD.md` | `ft daily --write` |
| Per-project briefs (Goal/Now/Next + recent agent queries) | `~/.fieldtheory/library/projects/<repo>.md` | `ft sync-projects` |
| Per-bookmark pages | `~/.fieldtheory/library/bookmarks/*.md` | `ft md --canonical` |
| YouTube notes | `~/.fieldtheory/library/youtube/<YYYY-MM>/<videoId>.md` | `ft sync-youtube` |
| Canonical SQLite (FTS5, all sources) | `~/.fieldtheory/bookmarks/bookmarks.db` | `ft index` / any sync |

Sources in the canonical index: `x`, `raindrop`, `github-stars`, `youtube`, `project`.

## Recall ladder (cheapest first)

1. **Always-affordable context**: read `interests.md` + `projects-active.md` (≤200 lines combined).
2. **Temporal recall** ("yesterday", "last week"): read/grep `library/daily/<date>.md`.
3. **Topic search**: `ft research "<topic>" --json` (ranked cross-source), or direct SQL:
   ```bash
   sqlite3 ~/.fieldtheory/bookmarks/bookmarks.db \
     "SELECT display_title, canonical_url, sources_json, last_saved_at
      FROM canonical_bookmarks c JOIN canonical_bookmarks_fts f ON f.rowid = c.rowid
      WHERE canonical_bookmarks_fts MATCH '<topic>' ORDER BY bm25(f) LIMIT 15"
   ```
4. **Deep read**: open the markdown paths returned by step 3; `ft show <id> --unified --json` for one item; `ft experts search "<topic>"` for who to follow up with.
5. **Synthesized answer**: `ft ask "<question>" --json` (LLM-grounded over the library).

## Rules

- Cite dates and sources verbatim from the files; never invent items.
- Timestamps in the db are mixed-format (ISO with offsets, Twitter-style `Wed Sep 30 ... 2020`) — compare parsed dates, not strings.
- `search_text` includes project Goal/Now/Next and recent agent prompts — treat it as private context, do not echo wholesale into public outputs (PRs, issues).
- Nothing found = say so and move on; do not pad.

The Claude Code global skill `second-brain` (`~/.claude/skills/second-brain/SKILL.md`) implements this contract.
