# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T184713Z-8tgs6e
- Backend: codex
- Task type: implement
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: write-enabled
- Model: gpt-5.6-terra

## Objective

Three review findings on your enrichment change — fix all:
1. HIGH SSRF (src/daily/enrich.ts:148-162): validate hosts before fetching and on every redirect hop. Reject: non-http(s) schemes, literal IPs in private/reserved ranges (10/8, 172.16/12, 192.168/16, 127/8, 169.254/16, ::1, fc00::/7, 0.0.0.0), and hostnames 'localhost'/*.local. Implement by disabling auto-redirect (redirect: 'manual') and following up to 5 hops, validating each URL. DNS-rebinding-level protection is out of scope — hostname/IP-literal checks suffice; note that in a comment.
2. HIGH hang (src/llm/opencode-client.ts:46-65): add AbortController timeout (default 30s, option-overridable) to the completion fetch so a stalled Zen Go request cannot hang the digest's Promise.all.
3. LOW (src/daily/enrich.ts:169-170): the no-body branch calls response.text() unbounded — enforce the 200KB cap on every response path (bounded reader everywhere).
Add tests: private-IP URL never fetched (seam asserts fetch not called for http://192.168.1.1/x and for a redirect hop to 127.0.0.1); LLM timeout aborts and enrichment records failed without hanging (use a never-resolving fetch stub + short timeout override). Run node --import tsx --test tests/daily.test.ts tests/opencode-client.test.ts && npm run build. Concise summary.

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
