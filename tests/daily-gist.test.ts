import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGistPrompt, generateDailyGists, notesMaterial } from '../src/daily/gist.js';
import { isTruncatedTitle, summarizeSavedText } from '../src/daily/summary.js';
import { dailyItemBody, dailyItemHeadline, relatedTitle, themeLede } from '../src/daily/synthesize.js';
import type { CanonicalRecentItem } from '../src/canonical-bookmarks-db.js';

const item = (overrides: Partial<CanonicalRecentItem>): CanonicalRecentItem => ({
  id: 'canonical:1', canonicalUrl: 'https://example.com/a', displayTitle: 'A title', searchText: 'A title',
  sources: ['raindrop'], firstSavedAt: '2026-10-01T00:00:00Z', lastSavedAt: null, primaryCategory: null, primaryDomain: 'example.com',
  ...overrides,
});

const POST_TITLE = 'Pick up a pencil. These animation-meets-live-action videos seem to be a real hit, and I totally get why. There is so m';
const POST = `${POST_TITLE}uch room to get creative with them. In half an hour I will share all my tricks for making them.`;

test('gist: a post title cut mid-word keeps the whole post as the body and a clean headline', () => {
  const post = item({ displayTitle: POST_TITLE, searchText: `${POST_TITLE}\n${POST}\nArtedeingenio\nx.com`, sources: ['x'] });
  assert.equal(isTruncatedTitle(post), true);
  assert.ok(summarizeSavedText(post, 700).startsWith('Pick up a pencil.'));
  assert.ok(summarizeSavedText(post, 700).includes('so much room to get creative'));
  const headline = dailyItemHeadline(post);
  assert.ok(headline.length <= 90 && !/\sm$/.test(headline), headline);
  assert.ok(dailyItemBody(post).includes('so much room'));
});

test('gist: a real title followed by prose is not treated as a truncated post', () => {
  const article = item({ displayTitle: 'Why State is the Hardest Thing', searchText: 'Why State is the Hardest Thing\nin this article we look at why state is hard and how to manage it.' });
  assert.equal(isTruncatedTitle(article), false);
  assert.equal(dailyItemHeadline(article), 'Why State is the Hardest Thing');
});

test('gist: feed boilerplate is removed from the mechanical excerpt', () => {
  const feed = item({
    displayTitle: 'Merging LLMs and economics research',
    searchText: 'Merging LLMs and economics research\nWe introduce an open-source workflow that reproduces an economics article. The workflow flags […] The post Merging LLMs and economics research appeared first on Marginal REVOLUTION.',
  });
  const summary = summarizeSavedText(feed, 700);
  assert.doesNotMatch(summary, /appeared first on|\[…\]/);
});

test('gist: generated gists replace headline and body, and bad entries are ignored', async () => {
  const one = item({ id: 'canonical:1', searchText: 'A title\nlong enough saved text to be worth condensing into a gist for the reader.' });
  const two = item({ id: 'canonical:2', displayTitle: 'owner/repo', searchText: 'owner/repo\nSelf-hostable thing TypeScript owner GitHub Stars' });
  const prompts: string[] = [];
  const gists = await generateDailyGists([one, two], {
    invoke: async (prompt) => {
      prompts.push(prompt);
      return `Sure:\n${JSON.stringify([
        { id: 'g1', headline: 'A complete headline…', gist: 'First  claim. Then the number 42.' },
        { id: 'g2', headline: 'x'.repeat(200), gist: '' },
        { id: 'g9', headline: 'invented', gist: 'invented' },
      ])}`;
    },
  });
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /id=g1 /);
  assert.deepEqual(gists.get('canonical:1'), { headline: 'A complete headline', gist: 'First claim. Then the number 42.' });
  assert.equal(gists.has('canonical:2'), false);
  assert.equal(gists.size, 1);
  assert.equal(dailyItemHeadline(one, gists.get('canonical:1')), 'A complete headline');
  assert.equal(dailyItemBody(one, gists.get('canonical:1')), 'First claim. Then the number 42.');
});

test('gist: a failing batch leaves other batches intact and never throws', async () => {
  const items = Array.from({ length: 4 }, (_, index) => item({ id: `canonical:${index}`, searchText: `text ${index}` }));
  const errors: string[] = [];
  let call = 0;
  const gists = await generateDailyGists(items, {
    batchSize: 2,
    concurrency: 1,
    onBatchError: (error) => errors.push(error),
    invoke: async () => {
      call += 1;
      if (call === 1) throw new Error('engine down');
      return JSON.stringify([{ id: 'g1', gist: 'Kept.' }, { id: 'g2', gist: 'Also kept.' }]);
    },
  });
  assert.deepEqual(errors, ['engine down']);
  assert.deepEqual([...gists.keys()], ['canonical:2', 'canonical:3']);
});

test('gist: notes material keeps the summary and key points, not chapters or frontmatter', () => {
  const material = notesMaterial('---\nsource: youtube\n---\n\n# Title\n\nThe summary.\n\n## Key points\n\n- Point one.\n\n## Chapters\n\n- [00:00](https://youtu.be/x) Intro\n');
  assert.equal(material, 'The summary. ## Key points - Point one.');
  assert.match(buildGistPrompt([{ alias: 'g1', item: item({}), material }]), /Point one/);
});

test('gist: related titles end on a word and the throughline uses one sentence', () => {
  const cut = 'Switching from one agent ecosystem to another stinks. If only there were a way for you to switch between Claude Code, Cu';
  assert.ok(relatedTitle(cut).endsWith('Claude Code…'), relatedTitle(cut));
  assert.equal(relatedTitle('Short title'), 'Short title');
  assert.equal(relatedTitle('Volatile Markets on X: "IT WORKS! Two islands.\n A cable between them. " / X'), 'Volatile Markets: IT WORKS! Two islands. A cable between them.');
  assert.equal(themeLede('First sentence here. Second sentence.'), 'First sentence here.');
});
