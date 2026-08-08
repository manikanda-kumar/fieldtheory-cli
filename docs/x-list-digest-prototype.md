# X List Digest Prototype

Prototype reference for fetching a public X list into a local JSON and HTML digest.

## Reference list

- X list URL: https://x.com/i/lists/1979812953135497678
- X list ID: `1979812953135497678`

## Shipped command

The prototype graduated into a first-class CLI command:

```bash
ft x-list https://x.com/i/lists/1979812953135497678 --since-hours 12
```

- Fetches the list timeline for the time window, drops standalone quoted originals, and writes a sortable HTML digest to a temp file (path printed). Pass `--html-output <path>` to choose the file, `--output <path>` for the digest JSON, or `--json` to print JSON to stdout.
- The HTML toolbar sorts cards client-side by reposts, likes, replies, quotes, views, or recency, with a high/low direction toggle.
- Other flags: `--count`, `--max-pages`, `--delay-ms`, `--browser`, `--chrome-user-data-dir`, `--chrome-profile-directory`, `--firefox-profile-dir`, `--query-id`.

## Storage

With no `--html-output`/`--output`, digests are written to `~/.fieldtheory/x-lists/`:

- `<listId>-<YYYY-MM-DD-HH-MM>.html` and `.json` (one per run; JSON omits raw GraphQL pages).
- `<listId>-latest.html` is overwritten each run as a stable pointer.

Each external link is badged by source type (GitHub, YouTube, Hugging Face, arXiv, Blog, HN, npm, …).

## Daily summary

`ft x-list-summary <list>` turns the stored `<listId>-latest.json` into a markdown briefing (Top themes / Notable releases & links / Worth a closer look) via the LLM engine chain (`FT_DAILY_ENGINE`/`FT_DAILY_MODEL`/`FT_DAILY_EFFORT`, same contract as `ft daily`), with a mechanical top-posts fallback when every engine fails:

- Output: `~/.fieldtheory/library/daily/x-list/<YYYY-MM-DD>.md` plus stable pointer `~/.fieldtheory/x-lists/<listId>-summary-latest.md`.
- Skips if today's summary already exists; `--force` regenerates. `--tweets <n>` controls prompt size (default 80 top-engagement list tweets).
- `sync-all --x-list <id>` runs it automatically right after the fetch step, so the nightly launchd job produces the summary daily.

## Daily job (macOS launchd)

A LaunchAgent runs the digest once a day for the last 24h:

- `~/Library/LaunchAgents/dev.fieldtheory.xlist-daily.plist` — schedule (default 09:00).
- `~/.fieldtheory/x-lists/run-daily.sh` — wrapper; edit `FT_XLIST_ID` to change the list.
- Logs: `~/.fieldtheory/x-lists/daily.log`.

Manage:

```bash
launchctl unload ~/Library/LaunchAgents/dev.fieldtheory.xlist-daily.plist
launchctl load   ~/Library/LaunchAgents/dev.fieldtheory.xlist-daily.plist
~/.fieldtheory/x-lists/run-daily.sh   # run once now
```

## Prototype command (dev script)

```bash
npx tsx scripts/prototype-fetch-x-list.ts \
  https://x.com/i/lists/1979812953135497678 \
  --count 100 \
  --since-hours 12 \
  --max-pages 5 \
  --output /tmp/fieldtheory-list.json \
  --html-output /tmp/fieldtheory-list.html
```

## Notes

Both paths share `src/x-list-fetch.ts` (`fetchXListDigest`), which uses the browser-session GraphQL approach already used by FieldTheory's X bookmark sync. It classifies direct list tweets separately from conversation context, filters by timestamp, removes standalone quoted originals when the quote tweet preserves that context, and renders inline media. HTML rendering lives in `src/x-list-html.ts` (`renderXListHtml`).
