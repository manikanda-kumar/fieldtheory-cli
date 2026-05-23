import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCli, parseVideoIdsText } from '../src/cli.js';

test('ft sync-youtube help shows notes-only flags', () => {
  const program = buildCli();
  const cmd = program.commands.find((command: any) => command.name() === 'sync-youtube');
  assert.ok(cmd, 'sync-youtube command should be registered');
  const opts = cmd.options.map((option: any) => option.long);
  for (const flag of ['--playlist', '--video-ids-file', '--overview', '--limit', '--force', '--dry-run', '--engine', '--model', '--effort', '--cookies-from-browser', '--impersonate']) {
    assert.ok(opts.includes(flag), `expected ${flag} among ${opts.join(', ')}`);
  }
});

test('parseVideoIdsText parses retry files with comments and dedupes ids', () => {
  assert.deepEqual(parseVideoIdsText('abc\n# retry later\n\ndef\nabc\n  ghi  \n'), ['abc', 'def', 'ghi']);
});
