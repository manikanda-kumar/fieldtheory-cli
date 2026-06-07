# X List Digest Prototype

Prototype reference for fetching a public X list into a local JSON and HTML digest.

## Reference list

- X list URL: https://x.com/i/lists/1979812953135497678
- X list ID: `1979812953135497678`

## Example command

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

The prototype uses the browser-session GraphQL approach already used by FieldTheory's X bookmark sync. It classifies direct list tweets separately from conversation context, filters by timestamp, removes standalone quoted originals when the quote tweet preserves that context, and can render a static HTML preview with inline media.
