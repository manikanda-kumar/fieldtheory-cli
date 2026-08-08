# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: amp-20260712T114833Z-pqq1yp
- Backend: amp
- Task type: review
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: read-only-by-default
- Mode: high

## Objective

Review the unstaged changes in src/engine.ts, src/cli.ts, src/llm/droid-engine.ts, src/llm/opencode-client.ts, and tests/engine.test.ts. This commit wires a new 'agy' (Antigravity CLI, Gemini 3.5 Flash via subscription) LLM engine into Field Theory's engine registry, and adds an opt-in FT_DEEPSEEK_NO_REASONING=1 env flag that injects thinking:{type:'disabled'} into the OpenCode Go proxy request body (verified empirically against the proxy: reasoning_effort:'none' annihilates the response, but thinking:{type:'disabled'} cleanly returns message.content with no reasoning_content and no reasoning_tokens). Focus on: (1) correctness of the agy engine registry entry — args layout, --print-timeout, system-prompt folding (matching codex pattern); (2) the resolveEngine resolve() wiring for agy model defaults (FT_AGY_MODEL env override, AGY_DEFAULT_MODEL constant); (3) the duplicated thinkingDisabled()/THINKING_DISABLED_BODY block across droid-engine.ts and opencode-client.ts — is the duplication acceptable or should it be factored; (4) the new engine.test.ts agy cases (fakeBin override pattern, FT_AGY_MODEL restore); (5) any correctness issues with how thinking-disabled is gated (env var only, default-off preserves existing behavior); (6) help-text consistency in cli.ts. Verify the diff with git diff. Run npm run build and npx tsx --test tests/engine.test.ts if useful.

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
