---
title: Daily Digest No-Item-Left-Behind - Plan
type: fix
date: 2026-07-10
topic: daily-digest-no-item-left-behind
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: code
---

# Daily Digest No-Item-Left-Behind - Plan

## Goal Capsule

- **Objective:** Guarantee every item collected for `ft daily` appears in the digest, no item is permanently skipped by caps or watermark movement, and every digest reports its own coverage truthfully.
- **Product authority:** This document (brainstorm dialogue, 2026-07-10). Gap inventory grounded in `docs/ideation/2026-07-10-daily-digest-surprise.html` (idea #0).
- **Open blockers:** None.

---

## Product Contract

### Summary

Harden the `ft daily` pipeline so the digest becomes a complete, auditable record of a window: uncited items render in a mechanical "Also saved" section, overflow carries to the next digest instead of vanishing behind the watermark, and a mechanical coverage footer reports per-source freshness, dark sources, and this run's counts.

### Problem Frame

The digest silently loses items at several stages. The LLM synthesis step renders only items it cites in a theme — anything it omits never appears, with no trace in the output. Theme validation compounds this: themes beyond the cap are sliced off with their items, and themes that fail citation validation are discarded wholesale. On the collection side, the watermark advances unconditionally to the window end even when the item cap truncated the collection, so truncated items fall behind the watermark and are never seen again. A digest for an explicit past date also rewrites the live watermark, which can rewind or corrupt the rolling window.

The digest also misrepresents its own coverage. Two of the seven consumption sources (x-list, following) have no canonical ingest at all, items with missing or unparseable save dates are invisible forever, and a source that stops syncing simply disappears from digests without warning. A partial digest is indistinguishable from a complete one.

### Key Decisions

- **Mechanical "Also saved" section over a second LLM placement pass.** Deterministic guarantee at zero LLM cost; honest about being uncurated. A retry pass could also fail and would still need a mechanical fallback.
- **Carry-over on overflow over a "+N more" summary line.** Nothing is lost; a large backfill digests over several days rather than producing one unusable mega-digest or dropping items.
- **Full coverage footer now, not counts-only.** Per-source freshness and dark-source flags land in this pass, accepting that it pulls per-source sync-state reading into scope.
- **Dark sources are a deliberate, persistent nag.** x-list and following show as "not indexed" in every digest until their ingest ships — visible debt, not hidden debt.
- **Footer is mechanical, never LLM-generated.** Coverage reporting is only useful if it is ground truth.

### Requirements

**Rendering guarantee**

- R1. Every collected item appears in the digest exactly once: cited in a theme, or listed in an "Also saved" section.
- R2. "Also saved" renders items in the same shape as theme items (linked title, sources, saved date, YouTube notes link when available), placed after the themed sections; the section is omitted when every item was themed.
- R3. Items lost during theme validation — themes beyond the theme cap, themes discarded for invalid citations, items the LLM never cited — route to "Also saved" instead of being dropped.
- R4. Synthesis fallback (mechanical grouping when the LLM fails) preserves the same guarantee: all collected items render.

**Watermark and overflow**

- R5. The watermark advances only past items that were actually collected; when a window holds more items than the collection cap, the excess is carried over and surfaces in subsequent digests until drained.
- R6. Carried-over items are not reordered into permanent starvation: repeated overflow windows must still drain oldest carry-overs eventually.
- R7. A digest generated for an explicit past date (`--date`) must not move the live rolling watermark.

**Coverage footer**

- R8. Every digest ends with a mechanically generated coverage footer reporting: per-source last-sync freshness (or "never synced"), sources known to exist but absent from canonical ingest (currently x-list, following), and this run's counts — collected, themed, also-saved, carried-over, citations dropped, undateable items excluded, synthesis mode.
- R9. The footer degrades gracefully: a missing or unreadable source state yields "unknown" or "never synced" and never fails digest generation.
- R10. Digest frontmatter carries the same counts as machine-readable fields for downstream tooling.
- R11. Items excluded for missing or unparseable save dates remain excluded from rendering, but are counted in the footer.

### Acceptance Examples

- AE1. **Covers R1, R3.** Given 11 collected items and the LLM cites 9 across its themes, when the digest renders, then the 2 uncited items appear under "Also saved" and the footer reports themed: 9, also-saved: 2.
- AE2. **Covers R3.** Given the LLM returns 9 themes and the cap is 7, when validation slices to 7, then items cited only by the two dropped themes render under "Also saved".
- AE3. **Covers R5, R8.** Given 250 new items in the window and a collection cap of 200, when the digest runs, then 200 items render, the footer reports carried-over: 50, the watermark does not pass the carried items, and the next digest includes them.
- AE4. **Covers R8, R9.** Given Raindrop has never synced, when the digest renders, then the footer shows Raindrop as "never synced" and digest generation succeeds.
- AE5. **Covers R7.** Given a live watermark at 2026-07-10 and a rerun of `ft daily --date 2026-07-01 --write --force`, when the historical digest is written, then the live watermark still reads 2026-07-10 and the next rolling digest window is unaffected.
- AE6. **Covers R11.** Given 3 canonical items with unparseable save dates, when the digest renders, then those items do not appear in themes or "Also saved" and the footer reports undateable-excluded: 3.

### Success Criteria

- The reconciliation invariant holds on every digest: collected = themed + also-saved, and collected + carried-over = window total.
- A digest can be audited for completeness from its own output alone — no need to query the database to know what was skipped and why.

### Scope Boundaries

Deferred for later (flagged by the footer, filled by separate work):

- Canonical ingest for x-list and following (the two dark sources; includes the unimplemented plan item of reading the latest x-list digest JSON at collection).
- Per-source watermarks (late-landing syncs whose items predate the global watermark).
- Re-engagement surfacing (earliest-date merge masks new activity on already-known URLs).
- Rescuing undateable items (assigning fallback dates so they can ever appear).
- Synthesis-quality improvements: related-link dedup and ranking, single-item theme suppression, and the ideation doc's ideas #1–#8.

### Outstanding Questions

Deferred to planning:

- Collection order under overflow (which 200 of 250 render first) — any order satisfies R5/R6; pick at planning time.
- Where each source's last-sync freshness is read from (each source keeps its own state/meta file).

### Sources

- `src/daily/collect.ts` — window/watermark logic, 200-item cap, project deltas.
- `src/daily/synthesize.ts` — theme validation (`validateThemes`, 7-theme slice), themed-only rendering (`renderDigestMarkdown`), unconditional watermark write at the end of `synthesizeDaily`.
- `src/canonical-bookmarks-db.ts` — canonical ingest covers only X, Raindrop, GitHub-stars, Projects, YouTube (`rebuildCanonicalIndex`); earliest-date merge; `getCanonicalBookmarksSince` null-date exclusion.
- `docs/ideation/2026-07-10-daily-digest-surprise.html` — full gap inventory (idea #0 and skip-vector table).
- `docs/plans/2026-07-07-companion-agent-daily-synthesis.md` — original `ft daily` design; section 4.1 names the x-list collection input that was never implemented.
