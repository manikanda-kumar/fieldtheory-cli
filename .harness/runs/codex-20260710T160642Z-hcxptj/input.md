Implement the 'rendering guarantee' slice of the plan at docs/plans/2026-07-10-001-fix-daily-digest-no-item-left-behind-plan.md (read it first). Scope: requirements R1-R4 and acceptance examples AE1-AE2 ONLY. Do not implement watermark/overflow changes (R5-R7) or the coverage footer (R8-R11) — those are later tasks.

Concretely, in src/daily/synthesize.ts:
1. After theme validation, compute orphan items: collected items (collection.items) not cited in any surviving theme's itemIds — whether because the LLM omitted them, their theme was sliced off by the MAX_THEMES cap, or their theme was discarded by citation validation.
2. Render orphans in a new 'Also saved' section: same bullet shape as theme items (linked title, sources joined, saved date, YouTube notes-link suffix via the existing notesSuffix helper). Place it after all themed sections and before 'Project activity'. Omit the section entirely when every item was themed.
3. The mechanical fallback path (mechanicalThemes) must preserve the same every-item-renders guarantee (it already covers all items — verify, don't break).
4. Expose the counts (themedCount, alsoSavedCount) on SynthesizeDailyResult for later use, but do NOT render a footer.

Add tests to tests/daily.test.ts using the existing test patterns there (the invoke test seam on synthesizeDaily): AE1 — 11 items, LLM cites 9 → 2 appear under 'Also saved', result counts themed:9 alsoSaved:2. AE2 — LLM returns more themes than the cap → items cited only by dropped themes appear under 'Also saved'.

Match existing code style (comment density, naming). Run: npx tsx --test tests/daily.test.ts — must pass. Also run npm run build to confirm the TypeScript compiles. Report what you changed as a concise summary.
