Add link enrichment for thin bookmarks to the daily digest pipeline, so bare links get real content for LLM theming instead of being skipped. The thin-content filter (THIN_CONTENT_CHARS, contentLength in src/daily/synthesize.ts) just landed — enrichment upgrades thin items into the prompt partition; the skip remains the fallback.

1. New src/llm/opencode-client.ts — minimal OpenAI-compatible chat client, mirroring the style of src/llm/openrouter-client.ts (read it first). Base URL https://opencode.ai/zen/go/v1, key from OPENCODE_GO_API_KEY ?? OPENCODE_API_KEY, default model 'deepseek-v4-flash' (override via FT_ENRICH_MODEL). CRITICAL quirk (verified live): deepseek-v4-flash is a reasoning model — responses carry reasoning_content and the answer in message.content; with small max_tokens the whole budget goes to reasoning and content is EMPTY with finish_reason 'length'. Set max_tokens >= 600 and read message.content; if empty, treat as failure (do not scrape reasoning_content).

2. New src/daily/enrich.ts:
   - enrichThinItems(items, opts): for collection items where contentLength(searchText) < THIN_CONTENT_CHARS and canonicalUrl is http(s) and not an x.com/twitter.com status URL (tweet pages need auth — skip them):
     a. Check durable cache first: new SQLite table link_enrichment(url PRIMARY KEY, summary TEXT, status TEXT, enriched_at TEXT) in the same bookmarks db (initCanonicalSchema-style CREATE IF NOT EXISTS — table must NOT be touched by rebuildCanonicalIndex's DELETEs; verify it is not).
     b. On miss: fetch the page (global fetch, ~8s timeout via AbortController, follow redirects, cap body read ~200KB, browser-ish UA). Extract title, meta/og description, and ~1200 chars of visible text (strip script/style/tags — regex is fine, no new deps).
     c. Targeted prompt: 'For a personal knowledge digest, summarize what this page is about in 2-3 plain sentences. No preamble.' + extracted material. Call the opencode client.
     d. Persist: status ok + summary, or status failed (retry eligible after 7 days — compare enriched_at).
   - Concurrency 4, per-run cap default 25 (FT_ENRICH_LIMIT env). Injectable fetch + llm seams for tests.
   - Never throw: any failure → item stays thin (T4 skip handles it).

3. Wire into ft daily (src/cli.ts daily command): after collectDaily, before connectDailyItems — enrich, then merge each ok summary into that item's searchText as ' summary: <text>' so both connect (FTS terms) and the synthesize thin-partition see enriched content. Merge cached summaries on every run (not just fresh ones). Expose enrichedCount through to synthesizeDaily.

4. Counts: footer + frontmatter gain enriched (links enriched this run incl. cache merges — pick one honest definition, label it, document). Reconciliation unaffected.

5. No key present / offline: enrichment silently no-ops (skipped, count 0), digest proceeds — never fail the digest. Log one stderr line when skipped for missing key.

6. Tests in tests/daily.test.ts (+ new tests/opencode-client.test.ts if warranted): (a) thin item + stubbed fetch/llm → summary cached, searchText merged, item lands in the LLM prompt partition (capture prompt via invoke seam, assert its title appears); (b) cache hit → no fetch called; (c) llm returns empty content → status failed, item stays thin, digest still writes; (d) no key → no-op. Use existing test patterns (withIsolatedDataDir, seams).

Run node --import tsx --test tests/daily.test.ts (and your new test file) && npm run build. Concise summary.
