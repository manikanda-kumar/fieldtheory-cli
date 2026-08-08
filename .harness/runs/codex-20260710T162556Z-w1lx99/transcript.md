summary: "Found 2 issues: stale cursor leakage after window clamping can skip items; collection retains an unbounded in-memory window."
evidence:
  - "P2 — src/daily/collect.ts:129-133: `lastRunItemId` is passed whenever the run is rolling, even if `windowFor` changed `sinceIso` from `meta.lastRunAt` to the 7-day clamp or future-watermark fallback (lines 84-86). `getCanonicalBookmarksSince` then applies that unrelated ID at the substituted boundary timestamp (src/canonical-bookmarks-db.ts:850), potentially skipping IDs at that boundary. Only pass the cursor when `sinceIso` still equals the parsed persisted `lastRunAt`, otherwise clear it."
  - "P2 — src/canonical-bookmarks-db.ts:838-856 and src/daily/collect.ts:129-136: the query loads every dated canonical row, then filters/sorts/maps every row in the window before `collectDaily` slices to 200. The seven-day cap bounds time but not ingestion volume; a large backfill or high-volume sync can still consume memory proportional to the whole database/window. Use database filtering/ordering and a bounded page (plus a count or `LIMIT maxItems + 1` if only overflow existence is needed)."
  - "Checked clean: normal equal-timestamp cursor progression is correct because items are sorted oldest-first by `(firstSavedAt, id)` and the next query excludes IDs `<= lastRunItemId` only at `sinceIso` (src/canonical-bookmarks-db.ts:845-855)."
  - "Checked clean: when `carriedOver === 0`, `nextWatermark` is `untilIso` (src/daily/collect.ts:138-141), and the meta spread explicitly removes a stale `lastRunItemId` before conditionally restoring a new one (src/daily/synthesize.ts:372-380)."
  - "Checked clean: the skipped early return does not advance metadata (src/daily/synthesize.ts:325-335). This is conservative and avoids skipping late-arriving items; no collected item exists to advance past."
  - "Checked clean: the mechanical fallback reaches rendering and the metadata write, so it persists the collection cursor (src/daily/synthesize.ts:353-380)."
  - "Checked clean: explicit `--date` builds its own `[sinceIso, untilIso)` window without reading the watermark for selection (src/daily/collect.ts:69-76), does not pass `lastRunItemId` (line 133), and never writes daily metadata (src/daily/synthesize.ts:372)."
files_changed: []
commands_run:
  - command: "git status --short; git diff -- src/daily/collect.ts src/daily/synthesize.ts src/canonical-bookmarks-db.ts; sed -n '1,260p' docs/plans/2026-07-10-001-fix-daily-digest-no-item-left-behind-plan.md"
    exit_code: 0
    summary: "Inspected scoped uncommitted diff and R5-R7 plan context."
  - command: "rg -n -C 5 \"function windowFor|windowFor\\(|getCanonicalBookmarksSince|synthesizeDaily\\(|lastRun(ItemId|At)|skipped\" src/daily src/canonical-bookmarks-db.ts tests/daily.test.ts; git diff --check; git diff -- tests/daily.test.ts"
    exit_code: 0
    summary: "Inspected control flow, tests, and whitespace."
  - command: "npm run build"
    exit_code: 0
    summary: "TypeScript build passed."
  - command: "npm test"
    exit_code: 1
    summary: "Could not run: tsx IPC socket creation was denied by the sandbox (EPERM)."
verification:
  status: "failed"
  details: "Static review and TypeScript build passed; test execution was blocked by sandbox IPC permissions."
blockers:
  - "Sandbox prevents tsx from creating its IPC socket under the system temp directory."
