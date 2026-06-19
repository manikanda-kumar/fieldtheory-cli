import { writeFileSync } from 'node:fs';
import { fetchXListDigest, LIST_LATEST_TWEETS_QUERY_ID, parseListId } from '../src/x-list-fetch.js';
import { renderXListHtml } from '../src/x-list-html.js';

interface Options {
  listId: string;
  count: number;
  cursor?: string;
  browser?: string;
  chromeUserDataDir?: string;
  chromeProfileDirectory?: string;
  firefoxProfileDir?: string;
  output?: string;
  rawOutput?: string;
  htmlOutput?: string;
  sinceHours?: number;
  maxPages: number;
  delayMs: number;
  queryId: string;
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseArgs(argv: string[]): Options {
  const rawListId = argv[0];
  if (!rawListId || rawListId.startsWith('--')) {
    throw new Error('Usage: tsx scripts/prototype-fetch-x-list.ts <list-id-or-url> [--count 40] [--output out.json]');
  }

  const options: Options = {
    listId: parseListId(rawListId),
    count: 40,
    maxPages: argv.includes('--since-hours') ? 5 : 1,
    delayMs: 750,
    queryId: LIST_LATEST_TWEETS_QUERY_ID,
  };

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--count':
        options.count = Number(takeValue(argv, i, arg));
        i += 1;
        break;
      case '--cursor':
        options.cursor = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--browser':
        options.browser = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--chrome-user-data-dir':
        options.chromeUserDataDir = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--chrome-profile-directory':
        options.chromeProfileDirectory = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--firefox-profile-dir':
        options.firefoxProfileDir = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--output':
        options.output = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--raw-output':
        options.rawOutput = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--html-output':
        options.htmlOutput = takeValue(argv, i, arg);
        i += 1;
        break;
      case '--since-hours':
        options.sinceHours = Number(takeValue(argv, i, arg));
        i += 1;
        break;
      case '--max-pages':
        options.maxPages = Number(takeValue(argv, i, arg));
        i += 1;
        break;
      case '--delay-ms':
        options.delayMs = Number(takeValue(argv, i, arg));
        i += 1;
        break;
      case '--query-id':
        options.queryId = takeValue(argv, i, arg);
        i += 1;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.count) || options.count < 1 || options.count > 100) {
    throw new Error('--count must be a number from 1 to 100');
  }
  if (options.sinceHours !== undefined && (!Number.isFinite(options.sinceHours) || options.sinceHours <= 0)) {
    throw new Error('--since-hours must be a positive number');
  }
  if (!Number.isFinite(options.maxPages) || options.maxPages < 1) {
    throw new Error('--max-pages must be a positive number');
  }
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new Error('--delay-ms must be zero or a positive number');
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const digest = await fetchXListDigest(options);

  if (options.rawOutput) {
    writeFileSync(options.rawOutput, `${JSON.stringify(digest.rawPages, null, 2)}\n`, { mode: 0o600 });
  }

  const output = { listId: digest.listId, fetchedAt: digest.fetchedAt, ...digest.stats, tweets: digest.tweets };

  if (options.htmlOutput) {
    writeFileSync(
      options.htmlOutput,
      renderXListHtml({ listId: digest.listId, fetchedAt: digest.fetchedAt, tweets: digest.tweets }),
      { mode: 0o600 }
    );
  }

  const rendered = `${JSON.stringify(output, null, 2)}\n`;
  if (options.output) {
    writeFileSync(options.output, rendered, { mode: 0o600 });
    console.log(`Wrote ${digest.tweets.length} tweets to ${options.output}`);
  } else {
    console.log(rendered);
  }

  if (options.htmlOutput) console.log(`Wrote HTML to ${options.htmlOutput}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
