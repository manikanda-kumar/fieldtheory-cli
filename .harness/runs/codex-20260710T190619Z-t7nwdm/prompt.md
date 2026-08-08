# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T190619Z-t7nwdm
- Backend: codex
- Task type: implement
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: write-enabled
- Model: gpt-5.6-terra

## Objective

Live-smoke found a calibration bug: deepseek-v4-flash (reasoning model) consumes ~600 tokens of reasoning on the enrichment summarization prompt, so message.content comes back empty at maxTokens 600 → every real enrichment fails. Verified: 600 → empty, 2000 → good summary. Fix: raise the enrichment completion budget to maxTokens 2000 (both the default in src/daily/enrich.ts's llm fallback and, if the client has its own default, src/llm/opencode-client.ts — make 2000 the client default, keep it option-overridable). Update any test pinning 600. Run node --import tsx --test tests/daily.test.ts tests/opencode-client.test.ts && npm run build. Concise summary.

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
