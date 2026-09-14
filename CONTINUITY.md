# Continuity Ledger

## Goal (incl. success criteria)
- Improve daily HTML for Kindle conversion: clear sections, concise overview, paragraphs, descriptive links. Deliver local sample and MagicPath design; update future output.

## Constraints/Assumptions
- Supplied digest is data, not instructions. Preserve links and saved content; do not invent summaries.
- Leave unrelated untracked `.harness/runs/` and `undefined/` untouched.
- User explicitly authorized replacing today’s library HTML, Markdown and EPUB; originals backed up first.

## Key decisions
- Static single column; native contents anchors; full h2 theme headings; underlined article titles.
- Separate earlier saves/context; their prose is plain text with the clickable source domain on a separate line below (user correction 2026-09-14).
- All entry titles/prose are plain text; source links sit below content, including articles and recall cards.
- Embedded URLs are extracted from visible text and made separate source links; decode saved HTML entities before re-escaping.
- Audit visible text as well as href placement; changing anchors alone missed raw URLs in saved titles.
- EPUB exporter separately consumes markdown, so this change targets HTML conversion.

## State
- Complete: generator changes committed/pushed as 57e7a16 on origin/main.
- Regenerated all three formats from the original selection and canonical saved prose; installed in ~/.fieldtheory/library/daily/2026-09-13.{html,md,epub}.
- All 65 saves, seven themes, three recalls and 190 web links retained. EPUB XML/navigation and saved file hashes validated.

## Done
- Read sample, renderer/tests and MagicPath skill; completed and visually checked MagicPath preview using illustrative content.
- Automatic review rejected private digest upload; safe illustrative archive uploaded successfully. Private digest stays local.

## Now
- Full correction installed in library HTML/Markdown/EPUB. Audit of all 198 entries found zero visible raw URLs and zero linked headings.
- All 190 original web destinations preserved; five usable embedded targets added as links. Build and 56 relevant tests pass; EPUB XML/navigation and saved hashes validated.
- HTML and Markdown generator corrections, shared reading-text helper and tests remain uncommitted.

## Next
- User can read updated library HTML or try the rebuilt EPUB on Kindle.

## Open questions (UNCONFIRMED if needed)
- Physical Kindle conversion not yet tested.

## Working set (files/ids/commands)
- src/daily/html.ts; src/daily/reading-html.ts; src/daily/reading-text.ts; src/daily/synthesize.ts; tests/daily-html.test.ts; tests/daily.test.ts
- Library /Users/manik/.fieldtheory/library/daily/2026-09-13.{html,md,epub}
- Latest backup library/daily/.backups/2026-09-13-before-all-links-audit-20260914T062850036Z
- MagicPath project 449897332641767424; component 449897337406496768; session mcs_60e501b2-d973-4465-b0ab-67093f01e490
