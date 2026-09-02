import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ResolvedEngine } from '../src/engine.js';
import { agyArgs, buildAgyVideoPrompt, createAgyVideoNotesClient, parseAgyStream, videoNotesUnavailableReason } from '../src/youtube/agy-video.js';

const agyEngine: ResolvedEngine = { name: 'agy', config: { bin: 'agy', args: () => [] }, model: 'Gemini 3.7 Flash (High)', label: 'agy' };
const claudeEngine: ResolvedEngine = { name: 'claude', config: { bin: 'claude', args: () => [] }, label: 'claude' };
const meta = { title: 'Firecrawl PDF parsing', channel: 'Firecrawl', durationSec: 315 };

const notesJson = JSON.stringify({
  videoType: 'tutorial',
  tldr: 'pdf-inspector parses 200 PDFs in 0.47s.',
  keyPoints: ['Benchmark table shows 0.875 overall, 0.915 NID, 0.814 TEDS.'],
  chapters: [{ tSec: 0, label: 'Intro', summary: 'Why PDFs break agents.' }, { tSec: 120, label: 'Benchmarks', summary: 'opendataloader-bench numbers on screen.' }],
  actionItems: [],
  topics: ['PDF parsing'],
});

function stream(lines: unknown[]): string {
  return lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n';
}

function viewFileStep(file: string, state = 'DONE') {
  return { event: 'step_update', step_update: { step_index: 2, state, step_type: 'tool', tool_name: 'view_file', tool_info: { name: 'view_file', parameters: { AbsolutePath: file } } } };
}

function resultEvent(response: string, extra: Record<string, unknown> = {}) {
  return { event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response, duration_seconds: 35.8, num_turns: 1, usage: { input_tokens: 45651, output_tokens: 4759, thinking_tokens: 3323, total_tokens: 50410 }, ...extra } };
}

function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-agy-video-'));
  return fn(dir).finally(() => fs.rmSync(dir, { recursive: true, force: true }));
}

test('parseAgyStream extracts view_file paths, response, status, model and usage; ignores junk lines', () => {
  const parsed = parseAgyStream(stream([
    'Warning: something on stdout',
    { event: 'init', init: { model: 'Gemini 3.7 Flash (High)', cwd: '/tmp' } },
    viewFileStep('/private/tmp/x/v.mp4', 'ACTIVE'),
    viewFileStep('/private/tmp/x/v.mp4', 'DONE'),
    '{not json',
    resultEvent('{"tldr":"x"}'),
  ]));
  assert.deepEqual(parsed.viewedFiles, ['/private/tmp/x/v.mp4']);
  assert.equal(parsed.response, '{"tldr":"x"}');
  assert.equal(parsed.status, 'SUCCESS');
  assert.equal(parsed.model, 'Gemini 3.7 Flash (High)');
  assert.deepEqual(parsed.usage, { totalTokens: 50410, inputTokens: 45651, outputTokens: 4759 });
});

test('videoNotesUnavailableReason / createAgyVideoNotesClient gate on engine, yt-dlp and env', () => {
  const hasCommand = () => true;
  assert.equal(videoNotesUnavailableReason({ engine: agyEngine, env: {}, hasCommand }), undefined);
  assert.match(videoNotesUnavailableReason({ engine: claudeEngine, env: {}, hasCommand })!, /need --engine agy/);
  assert.match(videoNotesUnavailableReason({ engine: agyEngine, env: {}, hasCommand: () => false })!, /yt-dlp/);
  assert.match(videoNotesUnavailableReason({ engine: agyEngine, env: { FT_YOUTUBE_VIDEO_NOTES: 'off' }, hasCommand })!, /FT_YOUTUBE_VIDEO_NOTES/);
  assert.equal(createAgyVideoNotesClient({ engine: claudeEngine, env: {}, hasCommand }), null);
  const client = createAgyVideoNotesClient({ engine: agyEngine, env: { FT_YOUTUBE_VIDEO_MAX_MINUTES: '45' }, hasCommand });
  assert.equal(client?.model, 'Gemini 3.7 Flash (High)');
  assert.match(client!.label, /agy\/Gemini 3.7 Flash \(High\).*144p.*45 min/);
});

test('agyArgs runs print mode with stream-json, skipped permissions and the model', () => {
  const args = agyArgs('PROMPT', agyEngine);
  assert.equal(args[0], '-p');
  assert.equal(args[1], 'PROMPT');
  assert.ok(args.includes('--dangerously-skip-permissions'));
  assert.deepEqual(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2), ['--output-format', 'stream-json']);
  assert.deepEqual(args.slice(-2), ['--model', 'Gemini 3.7 Flash (High)']);
});

test('buildAgyVideoPrompt names the file, forbids other tools and carries the shared video notes instructions', () => {
  const prompt = buildAgyVideoPrompt('/abs/v.mp4', meta);
  assert.match(prompt, /view_file tool on \/abs\/v\.mp4/);
  assert.match(prompt, /ONLY tool you may use/);
  assert.match(prompt, /never guess from the title/);
  assert.match(prompt, /shown on screen \(slides, diagrams, benchmark tables/);
  assert.match(prompt, /tSec values must be the real video time/);
  assert.match(prompt, /Title: Firecrawl PDF parsing/);
});

test('generateNotes downloads, runs agy in the artifacts dir, verifies view_file, parses notes and deletes the mp4', async () => {
  await withTempDir(async (dir) => {
    const calls: { download?: string; args?: string[]; cwd?: string } = {};
    const client = createAgyVideoNotesClient({
      engine: agyEngine,
      env: {},
      hasCommand: () => true,
      ytDlp: { cookiesFromBrowser: 'chrome' },
      artifactsDir: () => dir,
      download: async (videoId, outPath, ytDlp) => {
        assert.equal(videoId, 'qXYuhmGW524');
        assert.deepEqual(ytDlp, { cookiesFromBrowser: 'chrome' });
        calls.download = outPath;
        fs.writeFileSync(outPath, 'fake mp4');
      },
      runAgy: async (args, run) => {
        calls.args = args;
        calls.cwd = run.cwd;
        const file = fs.realpathSync(path.join(dir, 'qXYuhmGW524.144p.mp4'));
        return stream([{ event: 'init', init: { model: 'Gemini 3.7 Flash (High)' } }, viewFileStep(file), resultEvent(notesJson)]);
      },
    })!;

    const result = await client.generateNotes('qXYuhmGW524', meta);
    assert.equal(calls.download, path.join(dir, 'qXYuhmGW524.144p.mp4'));
    assert.equal(calls.cwd, dir);
    assert.match(calls.args![1], new RegExp(`view_file tool on ${fs.realpathSync(dir).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/qXYuhmGW524\\.144p\\.mp4`));
    assert.equal(result.notes.tldr, 'pdf-inspector parses 200 PDFs in 0.47s.');
    assert.equal(result.notes.chapters.length, 2);
    assert.equal(result.model, 'Gemini 3.7 Flash (High)');
    assert.equal(result.usage.totalTokens, 50410);
    assert.equal(fs.existsSync(path.join(dir, 'qXYuhmGW524.144p.mp4')), false, 'mp4 deleted after the run');
  });
});

test('generateNotes refuses notes when agy never called view_file on the video (fabrication guard)', async () => {
  await withTempDir(async (dir) => {
    const client = createAgyVideoNotesClient({
      engine: agyEngine,
      env: {},
      hasCommand: () => true,
      artifactsDir: () => dir,
      keepVideo: true,
      download: async (_id, outPath) => { fs.writeFileSync(outPath, 'fake mp4'); },
      runAgy: async () => stream([resultEvent(notesJson)]),
    })!;
    await assert.rejects(client.generateNotes('v1', meta), /did not call view_file.*refusing unverified notes/);

    const wrongFile = createAgyVideoNotesClient({
      engine: agyEngine,
      env: {},
      hasCommand: () => true,
      artifactsDir: () => dir,
      download: async (_id, outPath) => { fs.writeFileSync(outPath, 'fake mp4'); },
      runAgy: async () => stream([viewFileStep('/somewhere/else.mp4'), resultEvent(notesJson)]),
    })!;
    await assert.rejects(wrongFile.generateNotes('v2', meta), /saw: \/somewhere\/else\.mp4/);
    assert.equal(fs.existsSync(path.join(dir, 'v1.144p.mp4')), true, 'keepVideo leaves the file');
    assert.equal(fs.existsSync(path.join(dir, 'v2.144p.mp4')), false, 'mp4 deleted even on failure');
  });
});

test('generateNotes rejects empty or non-JSON responses and over-cap durations without downloading', async () => {
  await withTempDir(async (dir) => {
    const make = (response: string) => createAgyVideoNotesClient({
      engine: agyEngine,
      env: {},
      hasCommand: () => true,
      artifactsDir: () => dir,
      download: async (_id, outPath) => { fs.writeFileSync(outPath, 'fake mp4'); },
      runAgy: async () => stream([viewFileStep(fs.realpathSync(path.join(dir, 'v.144p.mp4'))), resultEvent(response)]),
    })!;
    await assert.rejects(make('').generateNotes('v', meta), /empty response/);
    await assert.rejects(make('{"error":"video unavailable"}').generateNotes('v', meta), /notes were empty/);
    await assert.rejects(make('sorry, I cannot watch videos').generateNotes('v', meta), /JSON|parse/i);

    let downloaded = false;
    const capped = createAgyVideoNotesClient({
      engine: agyEngine,
      env: {},
      hasCommand: () => true,
      maxMinutes: 10,
      artifactsDir: () => dir,
      download: async () => { downloaded = true; },
      runAgy: async () => '',
    })!;
    await assert.rejects(capped.generateNotes('long', { ...meta, durationSec: 11 * 60 }), /over the 10-minute cap/);
    assert.equal(downloaded, false);
  });
});
