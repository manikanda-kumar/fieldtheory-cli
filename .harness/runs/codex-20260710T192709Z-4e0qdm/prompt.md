# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T192709Z-4e0qdm
- Backend: codex
- Task type: implement
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: write-enabled
- Model: gpt-5.6-terra

## Objective

P1 review finding on your change — fix before we run the 3.7k backfill: concurrent writers clobber the sql.js snapshot db. Each writer (writeCache in src/daily/enrich.ts, rebuildCanonicalIndex, others via src/db.ts) opens an in-memory copy of bookmarks.db and later exports/replaces the ENTIRE file; overlapping open→save windows lose the other writer's rows, and both use the same fixed .tmp path. Fix minimally but correctly in src/db.ts (shared layer):
1. Unique temp file per save (pid + timestamp + random suffix), atomic rename.
2. Advisory lock file (bookmarks.db.lock, O_EXCL create with pid + timestamp; stale after 10 min → steal with warning) acquired for the WHOLE open-modify-save critical section of writers. Expose acquire/release helpers; wrap writeCache's open→save and rebuildCanonicalIndex's open→save. Waiters poll (250ms) up to 2 min then throw a clear error naming the lock path.
3. Keep the enrichment cache-write window short: writeCache should open the db fresh, apply its upserts, save, release — never hold across network calls (restructure src/daily/enrich.ts accordingly: enrich concurrently, then flush results in one short locked write; flush in batches of 50 during long backfills so a crash loses at most one batch).
Tests: two sequential writers preserve both writes; lock contention (hold lock, writer times out with the clear error); stale lock stolen. Run node --import tsx --test tests/daily.test.ts tests/canonical-bookmarks-db.test.ts tests/cli.test.ts (+ any db test file) && npm run build. Concise summary.

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
