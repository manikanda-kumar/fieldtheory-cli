Implement the final 'coverage footer' slice of docs/plans/2026-07-10-001-fix-daily-digest-no-item-left-behind-plan.md (read it first). Scope: R8-R11 + AE4, AE6. The rendering guarantee (Also saved, themedCount/alsoSavedCount) and watermark/overflow (carriedOver on DailyCollection) are already implemented — build on them, do not rework.

Requirements:
- R8: every digest ends with a mechanically generated '## Coverage' footer (after Project activity) reporting:
  (a) per-source last-sync freshness for the 5 indexed sources (x, raindrop, github-stars, youtube, projects) — last sync time or 'never synced', derived from each source's existing state/meta files (look at src/paths.ts, src/following/paths.ts, src/projects/paths.ts, src/youtube/state.ts, raindrop paths — find each source's cache/meta mtime or stored timestamp; pick the cheapest reliable signal per source and document it in a comment);
  (b) dark sources: a fixed line noting x-list and following are not yet in the canonical index;
  (c) this run's counts: collected, themed, also-saved, carried-over, citations dropped, undateable-excluded, synthesis mode (llm|mechanical).
- R9: graceful degradation — a missing/unreadable source state renders 'unknown' or 'never synced'; footer generation must never throw or fail the digest (wrap per-source probes in try/catch).
- R10: digest YAML frontmatter carries the same counts machine-readably (collected, themed, also_saved, carried_over, citations_dropped, undateable_excluded).
- R11: undateable items (null/unparseable first_saved_at) stay excluded from rendering but are counted — count them during collection (rows excluded for unparseable dates within the window query are hard to attribute; simplest correct: expose from getCanonicalBookmarksSince or count canonical rows with null first_saved_at overall — choose the simplest honest metric, name it precisely in the footer, document the choice).

Implementation shape: a new src/daily/coverage.ts module (probe functions + types) feeding renderDigestMarkdown via synthesize.ts; keep renderDigestMarkdown pure — pass coverage data in.

Tests in tests/daily.test.ts: AE4 — with no raindrop state present, digest renders and footer shows raindrop never synced. AE6 — undateable count appears in footer + frontmatter. Plus: footer counts reconcile (collected = themed + also-saved) in an overflow scenario.

Run node --import tsx --test tests/daily.test.ts && npm run build. Concise summary.
