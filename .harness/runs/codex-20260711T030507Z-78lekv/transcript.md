summary: "Finding: scoped crash guards in the backfill command suppress unrelated process-wide failures while the command runs. No issues found in retry counting, schema migration, pruning under normal serialized execution, or lock-held backoff."
evidence:
  - "P1 — src/cli.ts:1345-1359: `process.on('uncaughtException')` and `process.on('unhandledRejection')` install handlers on the global process. While enrichment is active, an exception/rejection from any other concurrent CLI work is merely logged and prevented from following its normal fatal/error path. The handlers are removed in `finally`, so cleanup is correct; the issue is their overly broad ownership."
  - "Retry path: src/daily/enrich.ts:311-328 retries at most three total attempts and only when the captured error matches transient status/network/empty-completion patterns; `attempted` increments once per link at lines 220-224, not per retry."
  - "`--retry-failed` is constrained by `isTransientError(cached.error)` at src/daily/enrich.ts:133-137, so cached 404/non-transient failures do not bypass the seven-day wait."
  - "Schema creation/migration is lock-protected at src/daily/enrich.ts:267-282. Fresh tables include `error`; legacy tables accept duplicate-column errors from the follow-up ALTER."
  - "Pruning at src/daily/enrich.ts:285-301 deletes only `status = 'failed'` entries whose current canonical item is ineligible; cached successful rows are retained."
  - "Network retry waits and per-item pacing occur before `writeCache`; DB locks are acquired only in write/schema/prune functions (src/daily/enrich.ts:209-215, 246-301)."
files_changed: []
commands_run:
  - command: "git show --stat --oneline --decorate --no-renames 02d5ef8; git show --format=fuller --no-ext-diff --unified=80 02d5ef8"
    exit_code: 0
    summary: "Inspected target commit and patch."
  - command: "nl -ba src/daily/enrich.ts; nl -ba src/cli.ts; nl -ba src/db.ts; git diff 02d5ef8^ 02d5ef8 -- src/daily/enrich.ts src/cli.ts"
    exit_code: 0
    summary: "Traced retry, guard, migration, pruning, and lock paths."
  - command: "node --import tsx --test tests/daily.test.ts tests/cli.test.ts"
    exit_code: 0
    summary: "66 passed, 0 failed."
verification:
  status: "passed"
  details: "Focused daily and CLI tests passed; static review identified one actionable global crash-guard issue."
blockers: []
