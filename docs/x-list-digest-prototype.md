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
