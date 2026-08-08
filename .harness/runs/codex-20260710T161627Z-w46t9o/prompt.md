# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T161627Z-w46t9o
- Backend: codex
- Task type: implement
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: write-enabled
- Model: gpt-5.6-terra

## Objective

Review finding (P2) on your change: cross-theme duplicate-citation dedup pollutes droppedCitations semantics. A VALID citation duplicated across themes now increments droppedCitations (synthesize.ts ~153,159), and an emptied duplicate-only theme adds another drop — but src/cli.ts:1371 reports this value as 'dropped invalid citations'. Fix: keep droppedCitations meaning invalid-alias/repo drops only; do NOT count cross-theme duplicate suppressions or the duplicate-only-theme skip into it. Track duplicates separately if useful (e.g., duplicateCitations on the validate result) but don't change the CLI. Add/adjust a test covering a valid citation duplicated across two themes: renders once, droppedCitations stays 0. Run node --import tsx --test tests/daily.test.ts and npm run build; both must pass. Concise summary.

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
