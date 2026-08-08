# Review: System Prompt Wiring Across LLM Engines

**Date:** 2026-06-21
**Scope:** PR adding proper system prompt support across Claude, Codex, and Droid engines
**Files changed:** 12 files (+416 / -60 lines)
**Test result:** 737/737 pass, build clean

---

## Summary

Previously, system prompts were buried inside the user message text. This change:

1. Introduces `withSystemOverride(task, prompt)` to wrap prompts with a dominant system block
2. Introduces `extractSystemPrompt(prompt)` to split combined prompts into `{system, user}`
3. Routes system prompts through native mechanisms:
   - **Claude:** `--system-prompt` CLI flag
   - **Codex:** prepended to user prompt text (no native flag)
   - **Droid:** proper API `system` message role

---

## Review Rounds

Three independent reviewers analyzed the diff:

1. **Worker droid** (parallel groups: engine/droid, classify prompts, YouTube prompts)
2. **Code-review droid** (correctness/security/maintainability focus)
3. **Oracle droid** (second-model review for bugs design-checks missed)

---

## Findings

### Accepted (Fixed)

| # | Finding | File | Fix |
|---|---------|------|-----|
| 1 | Codex `args` function accepted only 2 params, silently dropping system prompt | `src/engine.ts` | Updated to 3 params; prepends system text to user prompt |
| 2 | `extractSystemPrompt` carried literal `System:\n` prefix into `--system-prompt` | `src/engine.ts` | Strips `System:\n` prefix before returning |
| 3 | Test assumed first available engine is never droid | `tests/engine.test.ts` | Skips test when `available[0] === 'droid'` |

### Rejected (Pre-existing, not introduced by this PR)

| # | Finding | File | Reason |
|---|---------|------|--------|
| 4 | `isDroidAvailable` ignores disk auth (`~/.local/share/opencode/auth.json`) | `src/llm/droid-engine.ts` | Pre-existing limitation; documented in code comments |
| 5 | Droid path in `invokeEngineAsync` drops `opts.timeout` / `opts.maxBuffer` | `src/engine.ts` | `invokeDroid` never accepted timeout; no regression |
| 6 | `sanitizeBio` missing `</bio>` tag stripping | `src/following/classify.ts` | Pre-existing; bio tags were added in earlier following feature |
| 7 | `extractJson` uses greedy regex that can capture invalid spans | `src/seeds-model.ts` | Pre-existing seed-model code |
| 8 | `selectVisionSample` can return undefined on empty frames | `src/youtube/slides.ts` | Pre-existing slides code |
| 9 | Title/channel metadata lack prompt-injection filtering | `src/youtube/notes.ts`, `src/youtube/script.ts` | Pre-existing `sanitizeInline` behavior |
| 10 | `resolveApiKey` env overrides explicit options | `src/llm/droid-engine.ts` | Pre-existing design; callers never pass explicit apiKey |
| 11 | `redactSecrets` misses OpenCode Go key format | `src/engine.ts` | Droid uses HTTP not subprocess; key never appears in stderr |

### Rejected (False Positive / Intentional)

| # | Finding | File | Reason |
|---|---------|------|--------|
| 12 | JSDoc references non-existent `renderEnginePrompt` | `src/engine.ts` | Function exists in `src/youtube/llm.ts` |
| 13 | Test manipulates `OPENROUTER_API_KEY` env var | `tests/engine.test.ts` | Intentional isolation to prevent fallback masking |
| 14 | Wiki/ask prompts don't use `withSystemOverride()` | `src/md-prompts.ts` | Inline persona changes are functionally correct |

---

## Architecture Decisions

### Why not use `--system-prompt` for Codex?

Codex CLI (`codex exec`) does not expose a `--system-prompt` flag. The Codex `personality="none"` config suppresses the default assistant persona, but there is no native system message mechanism. System text is therefore prepended to the user prompt.

### Why strip `System:\n` in `extractSystemPrompt`?

`renderEnginePrompt()` (YouTube flows) produces `System:\n<system_text>` as the first section. When `extractSystemPrompt` detects this format, it strips the `System:\n` prefix before returning, so the actual system text passed to `--system-prompt` is clean.

### Why `isDroidAvailable` only checks env var?

Disk auth read (`~/.local/share/opencode/auth.json`) is async. `detectAvailableEngines()` and `engineIsAvailable()` are sync by design (used in CLI option parsing and TTY checks). The async disk read is deferred to `invokeDroid()` invocation time. This is a documented trade-off.

---

## Test Coverage

New tests added in `tests/engine.test.ts`:

- `claude args include --system-prompt when system prompt provided`
- `extractSystemPrompt splits withSystemOverride format`
- `extractSystemPrompt splits renderEnginePrompt format`
- `extractSystemPrompt returns whole prompt as user when no system block`

All 737 tests pass (including 30 following tests, 30 CLI tests, YouTube tests).

---

## Verdict

**LGTM** — No blocking issues. All actionable findings were fixed in-session. Pre-existing limitations were identified but not introduced by this change.
