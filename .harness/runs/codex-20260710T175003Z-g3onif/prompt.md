# Harness Worker Packet

## Contract

You are an internal worker for the use-harness router.
Return a concise report to the router; do not address the end user directly.
Do not claim success unless validation evidence is included.

## Assignment

- Run ID: codex-20260710T175003Z-g3onif
- Backend: codex
- Task type: implement
- Workspace: /Users/manik/Github/fieldtheory-cli
- Permission mode: write-enabled
- Model: gpt-5.6-terra

## Objective

Add a thin-content synthesis filter to the daily digest pipeline (src/daily/synthesize.ts + src/daily/coverage.ts). Motivation: ~21% of X bookmarks and ~29% of Raindrop items are bare link-shares — search_text is essentially a URL plus a few words; feeding them to the LLM theming prompt wastes tokens and degrades grouping to title-word matching.

Spec:
1. New exported helper in src/daily/synthesize.ts: contentLength(text) — length of search_text after stripping all URLs (regex https?://\S+ is sufficient) and collapsing whitespace. Named const THIN_CONTENT_CHARS = 120 with a comment explaining the bare-link rationale and the measured stats (21% of x, 29% of raindrop items historically).
2. In synthesizeDaily, partition collection.items into promptItems (contentLength >= THIN_CONTENT_CHARS) and thin items BEFORE building aliases/prompt. Only promptItems go into buildDailyAliases + buildDailyPrompt (aliases i1.. must number promptItems only, so the LLM never sees or cites thin items). Thin items are never themed — they flow into the existing Also saved section automatically via the uncited-items reconciliation (verify that path picks them up; do not special-case rendering).
3. Edge cases: if promptItems is empty but thin items exist, skip the LLM call entirely (usedLlm=false) and use mechanicalThemes ONLY over... careful: mechanicalThemes currently covers all collection.items — that would theme thin items. Decide the simplest honest behavior: when promptItems is empty, no LLM call, themes=[] and everything lands in Also saved. When the LLM fails with promptItems present, mechanicalThemes may keep covering all items (fallback is mechanical anyway — acceptable; document choice in a comment).
4. Counts: SynthesizeDailyResult and the coverage footer/frontmatter gain thinSkipped (footer label 'thin links skipped from synthesis', frontmatter thin_skipped). Reconciliation must still hold: collected = themed + also-saved; thinSkipped is a subset of also-saved, note that in the footer comment.
5. Tests in tests/daily.test.ts: (a) a bare-link item (long URL, few words) is excluded from the LLM prompt (assert via the invoke seam capturing the prompt string — it must not contain that item's alias/title), lands in Also saved, thinSkipped=1, reconciliation holds; (b) an item with a URL plus >=120 chars of commentary IS included in the prompt; (c) promptItems empty → no invoke call (assert invoke not called), all items in Also saved.

Run node --import tsx --test tests/daily.test.ts && npm run build. Concise summary.

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
