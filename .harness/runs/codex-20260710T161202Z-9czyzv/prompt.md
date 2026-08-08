# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T161202Z-9czyzv
- Backend: codex
- Task type: review
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: read-only-by-default
- Model: gpt-5.6-terra

## Objective

Review the uncommitted changes to src/daily/synthesize.ts and tests/daily.test.ts only (git diff those two files; ignore CONTINUITY.md and x-list-* changes — unrelated). Context: implements the 'rendering guarantee' from docs/plans/2026-07-10-001-fix-daily-digest-no-item-left-behind-plan.md — every collected item must render exactly once, in a theme or in the 'Also saved' section (R1-R4, AE1-AE2). Hunt for: correctness bugs (double-render, item lost in any path incl. mechanical fallback and skipped-digest path), the cross-theme duplicate-citation dedup changing droppedCitations semantics in a way that breaks existing consumers, edge cases (item id in theme.itemIds but missing from itemById map), test assertions that pass vacuously. Report findings ranked by severity with file:line; say 'no findings' if clean. Do not edit files.

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
