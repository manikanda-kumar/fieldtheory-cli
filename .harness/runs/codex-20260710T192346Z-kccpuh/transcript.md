summary: "1 high-severity finding: concurrent `enrich-backfill` and canonical rebuilds can overwrite each other’s whole sql.js database snapshots. No other confirmed issues in the requested areas."
evidence:
  - "P1 — src/daily/enrich.ts:143-154, 225-237; src/canonical-bookmarks-db.ts:662-739; src/db.ts:20-50. Each operation opens an independent in-memory copy of `bookmarks.db` and later exports/replaces the entire file. If `writeCache()` opens before a rebuild saves, its later save can restore stale canonical/FTS tables; if rebuild saves last, it can discard newly written enrichment rows. Both also use the same fixed `.tmp` path, so overlapping saves can fail or rename the other writer’s temp file. sql.js provides no inter-process locking here."
  - "Rebuild summary merge does not repeatedly append on normal rebuilds: groups are rebuilt from source records each time, then each cache summary is appended once before the FTS rebuild (src/canonical-bookmarks-db.ts:707-733)."
  - "Backfill and daily use the same eligibility predicate (`isEligible` aliases exported `isEnrichmentEligible`), and failed cache entries honor the 7-day retry cutoff (src/daily/enrich.ts:73-76, 105-125). `--all` remains concurrency-limited to four workers."
  - "The implementation loads all canonical rows and parses `sources_json` although eligibility does not need sources (src/daily/enrich.ts:164-176); at ~3.7k rows this is not a confirmed memory-risk finding, but projection could be narrowed later."
files_changed: []
commands_run:
  - command: "node --import tsx --test tests/daily.test.ts tests/canonical-bookmarks-db.test.ts tests/cli.test.ts"
    exit_code: 0
    summary: "80 passed, 0 failed."
  - command: "npm run build"
    exit_code: 0
    summary: "TypeScript build passed."
  - command: "git diff --check"
    exit_code: 0
    summary: "No whitespace errors."
verification:
  status: "passed"
  details: "Focused tests and build pass; concurrency race is not covered by the suite."
blockers: []
