# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T170131Z-ut9a4p
- Backend: codex
- Task type: review
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: read-only-by-default
- Model: gpt-5.6-terra

## Objective

Review the uncommitted coverage-footer changes: src/daily/coverage.ts (new), plus related edits in src/daily/synthesize.ts, src/daily/collect.ts, src/canonical-bookmarks-db.ts, tests/daily.test.ts. Context: R8-R11 of docs/plans/2026-07-10-001-fix-daily-digest-no-item-left-behind-plan.md — mechanical Coverage footer (per-source freshness, dark sources note, run counts), frontmatter machine-readable counts, graceful degradation, undateable count. Hunt for: (1) any probe path that can throw and kill digest generation (R9 — malformed JSON, permission errors), (2) footer counts not reconciling with actual render (collected != themed + alsoSaved cases), (3) frontmatter YAML validity when counts present, (4) the undateable metric mislabeled (it counts full canonical index, not window — footer text must say so honestly), (5) freshness probe reading wrong field or wrong file per source, (6) meta writes in synthesize interfering with coverage reads ordering, (7) dark-sources line accuracy. file:line findings ranked; 'no findings' if clean. Do not edit.

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
