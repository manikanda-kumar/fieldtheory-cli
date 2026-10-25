import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCli, parseVideoIdsText } from '../src/cli.js';
import { getLibraryDocById, reindexLibraryDocs } from '../src/library-index-db.js';

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

test('slide-only sync can finish without an audio engine; audio still requires one', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-youtube-cli-'));
  const before = { FT_DATA_DIR: process.env.FT_DATA_DIR, FT_LIBRARY_DIR: process.env.FT_LIBRARY_DIR, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
  const exitCode = process.exitCode;
  const error = console.error;
  const errors: string[] = [];
  t.after(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    process.exitCode = exitCode;
    console.error = error;
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.FT_DATA_DIR = path.join(root, 'bookmarks');
  process.env.FT_LIBRARY_DIR = path.join(root, 'library');
  delete process.env.OPENAI_API_KEY;
  console.error = (...args) => { errors.push(args.join(' ')); };
  const ids = path.join(root, 'ids.txt');
  fs.writeFileSync(ids, '# no pending videos\n');
  const args = ['node', 'ft', 'sync-youtube', '--video-ids-file', ids, '--engine', 'none', '--tts', 'openai'];

  await buildCli().parseAsync([...args, '--overview', 'slides']);
  assert.equal(process.exitCode ?? 0, 0, errors.join('\n'));
  assert.ok(fs.existsSync(path.join(root, 'library/youtube/index.html')));

  await buildCli().parseAsync([...args, '--overview', 'audio']);
  assert.equal(process.exitCode, 1);
  assert.match(errors.join('\n'), /OPENAI_API_KEY is required for OpenAI TTS/);
});

test('slide-link repair is read-only by default and refreshes indexed note bodies when written', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-slide-repair-cli-'));
  const before = { FT_DATA_DIR: process.env.FT_DATA_DIR, FT_LIBRARY_DIR: process.env.FT_LIBRARY_DIR, FT_COMMANDS_DIR: process.env.FT_COMMANDS_DIR };
  const exitCode = process.exitCode;
  t.after(() => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    process.exitCode = exitCode;
    fs.rmSync(root, { recursive: true, force: true });
  });
  process.env.FT_DATA_DIR = path.join(root, 'bookmarks');
  process.env.FT_LIBRARY_DIR = path.join(root, 'library');
  process.env.FT_COMMANDS_DIR = path.join(root, 'commands');
  const notePath = path.join(root, 'library/youtube/2026-10/v1.md');
  const slidePath = path.join(root, 'bookmarks/youtube/artifacts/v1/slide.png');
  fs.mkdirSync(path.dirname(notePath), { recursive: true });
  fs.mkdirSync(path.dirname(slidePath), { recursive: true });
  fs.writeFileSync(slidePath, 'png');
  const original = '---\nsynced: 2026-10-25T03:00:00Z\n---\n\n# Talk\n\n![Slide](/Users/manik/.fieldtheory/bookmarks/youtube/artifacts/v1/slide.png)\n';
  fs.writeFileSync(notePath, original);
  const args = ['node', 'ft', 'repair-youtube-slides', '--note', notePath];

  await buildCli().parseAsync(args);
  assert.equal(fs.readFileSync(notePath, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(root, 'bookmarks/library.db')), false);

  await reindexLibraryDocs();
  assert.equal((await getLibraryDocById('library:youtube/2026-10/v1.md'))?.body, original);
  await buildCli().parseAsync([...args, '--write']);
  assert.equal(process.exitCode ?? 0, 0);
  const repaired = original.replace('/Users/manik/.fieldtheory/bookmarks/youtube/artifacts/v1/slide.png', '../../../bookmarks/youtube/artifacts/v1/slide.png');
  assert.equal(fs.readFileSync(notePath, 'utf8'), repaired);
  assert.equal((await getLibraryDocById('library:youtube/2026-10/v1.md'))?.body, repaired);
});
