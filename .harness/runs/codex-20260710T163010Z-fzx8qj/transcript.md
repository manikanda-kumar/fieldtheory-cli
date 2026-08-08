summary: "Fixed stale overflow-cursor leakage after rolling-window clamping or fallback. The cursor is now applied only when effective sinceIso equals the persisted watermark instant."
evidence:
  - "Added regression coverage with a >7-day-old watermark and stale cursor; an item exactly at the clamped boundary is collected."
  - "Daily tests: 17/17 passed."
  - "TypeScript build passed."
files_changed:
  - "CONTINUITY.md"
  - "src/daily/collect.ts"
  - "tests/daily.test.ts"
commands_run:
  - command: "node --import tsx --test tests/daily.test.ts && npm run build"
    exit_code: 0
    summary: "17 daily tests passed; TypeScript build passed."
verification:
  status: "passed"
  details: "Validated the requested clamp-boundary cursor regression and build."
blockers: []
