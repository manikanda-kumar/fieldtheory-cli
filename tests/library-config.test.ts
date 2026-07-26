import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { defaultWikiConfig, ensureWikiConfig, extractWikiGuidance, readWikiGuidance, wikiConfigPath } from '../src/library-config.js';
import { wikiGuidanceBlock } from '../src/md-prompts.js';

async function withIsolatedLibrary(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-library-config-'));
  const savedLibrary = process.env.FT_LIBRARY_DIR;
  process.env.FT_LIBRARY_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (savedLibrary === undefined) delete process.env.FT_LIBRARY_DIR;
    else process.env.FT_LIBRARY_DIR = savedLibrary;
    await rm(dir, { recursive: true, force: true });
  }
}

test('extractWikiGuidance keeps the prompt-relevant sections and drops the rest', () => {
  const guidance = extractWikiGuidance(defaultWikiConfig('2026-07-26'));
  assert.match(guidance, /^Purpose:/);
  assert.match(guidance, /Audience:/);
  assert.match(guidance, /Style rules:/);
  assert.match(guidance, /Lead with the useful takeaway/);
  assert.doesNotMatch(guidance, /Maintenance rules/, 'maintenance rules are for humans, not prompts');
  assert.doesNotMatch(guidance, /tags: \[ft\/config\]/, 'frontmatter never reaches the prompt');
});

test('extractWikiGuidance reads a section that runs to the end of the file', () => {
  const guidance = extractWikiGuidance([
    '# Custom',
    '',
    '## Purpose',
    '',
    'Track one narrow topic.',
    '',
    '## Style rules',
    '',
    '- Be terse.',
    '- Cite everything.',
  ].join('\n'));
  assert.match(guidance, /Track one narrow topic\./);
  assert.match(guidance, /- Cite everything\./);
});

test('ensureWikiConfig seeds the config once and never overwrites an edited one', async () => {
  await withIsolatedLibrary(async () => {
    const first = await ensureWikiConfig('2026-07-26');
    assert.equal(first.created, true);
    assert.equal(first.path, wikiConfigPath());

    await writeFile(first.path, '# Mine\n\n## Purpose\n\nOnly what I choose.\n');
    const second = await ensureWikiConfig('2026-07-27');
    assert.equal(second.created, false);
    assert.match(await readFile(first.path, 'utf8'), /Only what I choose\./);

    const guidance = await readWikiGuidance();
    assert.match(guidance ?? '', /Only what I choose\./);
  });
});

test('readWikiGuidance returns undefined when no config exists', async () => {
  await withIsolatedLibrary(async () => {
    assert.equal(await readWikiGuidance(), undefined);
  });
});

test('wikiGuidanceBlock labels the config as author-owned and stays empty without one', () => {
  assert.equal(wikiGuidanceBlock(undefined), '');
  assert.equal(wikiGuidanceBlock('   '), '');
  const block = wikiGuidanceBlock('Purpose:\nTrack agents.');
  assert.match(block, /Library config/);
  assert.match(block, /Track agents\./);
});
