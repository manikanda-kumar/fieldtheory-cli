import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCli } from '../src/cli.js';

test('ft sync-youtube help shows notes-only flags', () => {
  const program = buildCli();
  const cmd = program.commands.find((command: any) => command.name() === 'sync-youtube');
  assert.ok(cmd, 'sync-youtube command should be registered');
  const opts = cmd.options.map((option: any) => option.long);
  for (const flag of ['--playlist', '--overview', '--limit', '--force', '--dry-run', '--model']) {
    assert.ok(opts.includes(flag), `expected ${flag} among ${opts.join(', ')}`);
  }
});
