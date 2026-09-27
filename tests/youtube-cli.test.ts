import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCli, parseVideoIdsText } from '../src/cli.js';

test('sync-all accumulates repeated playlists without changing sync-youtube parsing', async () => {
  const program = buildCli();
  const command = program.commands.find((cmd) => cmd.name() === 'sync-all')!;
  command.action(() => {});
  await program.parseAsync(['node', 'ft', 'sync-all', '--playlist', 'PLsaved', '--playlist', 'UUchannel', '--youtube-limit', '20']);
  assert.deepEqual(command.opts().playlist, ['PLsaved', 'UUchannel']);
  assert.equal(command.opts().youtubeLimit, 20);

  const single = buildCli();
  const youtube = single.commands.find((cmd) => cmd.name() === 'sync-youtube')!;
  youtube.action(() => {});
  await single.parseAsync(['node', 'ft', 'sync-youtube', '--playlist', 'PLsaved']);
  assert.equal(youtube.opts().playlist, 'PLsaved');
});

test('ft sync-youtube help shows notes-only flags', () => {
  const program = buildCli();
  const cmd = program.commands.find((command: any) => command.name() === 'sync-youtube');
  assert.ok(cmd, 'sync-youtube command should be registered');
  const opts = cmd.options.map((option: any) => option.long);
  for (const flag of ['--playlist', '--video-ids-file', '--overview', '--limit', '--force', '--dry-run', '--engine', '--model', '--effort', '--cookies-from-browser', '--impersonate', '--video-notes']) {
    assert.ok(opts.includes(flag), `expected ${flag} among ${opts.join(', ')}`);
  }
  const videoNotes = cmd.options.find((option: any) => option.long === '--video-notes');
  assert.match(videoNotes.description, /auto, on, or off/);
});

test('parseVideoIdsText parses retry files with comments and dedupes ids', () => {
  assert.deepEqual(parseVideoIdsText('abc\n# retry later\n\ndef\nabc\n  ghi  \n'), ['abc', 'def', 'ghi']);
});
