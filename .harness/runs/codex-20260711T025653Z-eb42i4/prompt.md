# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260711T025653Z-eb42i4
- Backend: codex
- Task type: implement
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: write-enabled
- Model: gpt-5.6-terra

## Objective

Harden link enrichment after a live 3.7k backfill run failed badly: 79% failure rate + process crash. Diagnosis (verified): (a) 551 failures are x.com/i/article URLs — auth-walled, eligibility only excluded /status/; (b) 76 youtube + 3 pdf — not meaningfully fetchable; (c) ~500 regular-web failures were load-induced (zen/go throttling under sustained concurrency-4; the same URLs succeed in isolation) with no failure reason recorded; (d) the process died from an unhandled 'error' event on a ClientHttp2Stream — async fetch-internal error that escapes try/catch. Fixes, all in src/daily/enrich.ts + src/cli.ts unless noted:

1. Eligibility: exclude ALL x.com/twitter.com URLs (not just /status/), youtube.com/youtu.be, and URLs ending .pdf. Keep the existing exclusions. Update the isEnrichmentEligible comment with the taxonomy.
2. Failure reasons: add 'error' TEXT column to link_enrichment (ALTER TABLE ... tolerate 'duplicate column'), store stage-prefixed cause ('fetch: <msg>', 'llm: <msg>', 'empty completion'). Surface top-3 error kinds in the backfill exit summary.
3. Transient resilience: retry LLM and page-fetch failures up to 2 times with exponential backoff + jitter (1s, 4s base) for transient causes (HTTP 429/5xx, ECONNRESET/ETIMEDOUT/aborted/network errors, empty completion). Non-transient (4xx except 429, SSRF-rejected, ineligible) fail immediately. Add --concurrency <n> flag to enrich-backfill (default 2 for backfill; ft daily keeps 4) and a small delay (250ms) between LLM calls per worker.
4. Crash guard: enrich-backfill installs process.on('uncaughtException') + process.on('unhandledRejection') handlers scoped to the command that log one line and continue (h2 stream errors escape fetch's promise chain; they must not kill a multi-hour run). Remove handlers when done.
5. Cache reset for the new rules: on backfill start, delete cached failed rows that are now ineligible (they'll never be attempted again anyway — keeps the table honest); treat remaining failed rows WITHOUT the 7-day wait when their error is transient-class and --retry-failed flag is passed. Add that flag.
Tests: eligibility exclusions (x article, youtube, pdf); retry on 429-then-success; non-transient no-retry; error column recorded; --retry-failed re-attempts a transient failed row. Run node --import tsx --test tests/daily.test.ts tests/cli.test.ts && npm run build. Concise summary.

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
