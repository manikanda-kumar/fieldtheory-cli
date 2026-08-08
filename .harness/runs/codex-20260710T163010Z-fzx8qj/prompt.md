# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T163010Z-fzx8qj
- Backend: codex
- Task type: implement
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: write-enabled
- Model: gpt-5.6-terra

## Objective

Review finding (P2) on your change: stale cursor leakage after window clamping. In src/daily/collect.ts you pass meta.lastRunItemId whenever the run is rolling, but windowFor may substitute sinceIso away from meta.lastRunAt (7-day clamp at oldestAllowed, or the future-watermark fallback). The cursor id then gets applied at an unrelated boundary timestamp inside getCanonicalBookmarksSince, potentially skipping items at that boundary. Fix: pass lastRunItemId only when the effective sinceIso still equals the persisted meta.lastRunAt instant (compare parsed epochs, not strings — meta value round-trips through Date). Otherwise pass undefined. Add a test: meta with lastRunAt older than 7 days + a lastRunItemId; collectDaily clamps to the 7-day window; items at the clamped boundary are NOT skipped. Run node --import tsx --test tests/daily.test.ts && npm run build. Concise summary.

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
