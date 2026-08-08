# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T192346Z-kccpuh
- Backend: codex
- Task type: review
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: read-only-by-default
- Model: gpt-5.6-terra

## Objective

Review uncommitted changes: ft enrich-backfill command (src/cli.ts), backlog core in src/daily/enrich.ts, summary merge in rebuildCanonicalIndex (src/canonical-bookmarks-db.ts), tests. Hunt: (1) rebuild merge appending ' summary:' repeatedly across rebuilds or interfering with preservedFields/FTS rebuild, (2) backfill pagination/limit bugs (same rows reprocessed, failed rows retried before 7d, --all runaway), (3) eligibility drift between backfill and daily paths, (4) progress/summary counts lying, (5) rebuild reading link_enrichment while another connection writes (sql.js single-file — any locking issue), (6) memory blowup loading 3.7k rows. file:line ranked; 'no findings' if clean. Do not edit.

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
