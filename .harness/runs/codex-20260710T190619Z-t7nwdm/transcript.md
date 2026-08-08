summary: "Raised the OpenCode enrichment completion default from 600 to 2,000 tokens so deepseek-v4-flash has room for both reasoning and `message.content`."
evidence:
  - "Daily enrichment now explicitly requests `maxTokens: 2000`."
  - "OpenCode client defaults to 2,000 while retaining caller overrides (with the existing 600-token safety floor)."
  - "Client regression test now asserts the 2,000-token default."
files_changed:
  - "CONTINUITY.md"
  - "src/daily/enrich.ts"
  - "src/llm/opencode-client.ts"
  - "tests/opencode-client.test.ts"
commands_run:
  - command: "node --import tsx --test tests/daily.test.ts tests/opencode-client.test.ts"
    exit_code: 0
    summary: "30 passed, 0 failed."
  - command: "npm run build"
    exit_code: 0
    summary: "TypeScript build passed."
  - command: "git diff --check"
    exit_code: 0
    summary: "No whitespace errors."
verification:
  status: "passed"
  details: "Required focused tests and build pass."
blockers: []
