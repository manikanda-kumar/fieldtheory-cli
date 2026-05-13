import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTtsClient, TtsUnavailableError } from '../src/llm/tts-client.js';

function stubFetch(chunks: Uint8Array[]) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const chunk = chunks.shift();
    if (!chunk) throw new Error('unexpected fetch call');
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
      text: async () => '',
    } as Response;
  };
  return { fetch, calls };
}

async function withTempFile<T>(fn: (outPath: string) => Promise<T>): Promise<T> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-tts-'));
  try {
    return await fn(path.join(dir, 'out.mp3'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

test('TTS OpenAI engine writes response bytes to outPath', async () => {
  await withTempFile(async (outPath) => {
    const { fetch, calls } = stubFetch([new Uint8Array([1, 2, 3])]);
    const client = createTtsClient({ engine: 'openai', apiKeys: { openai: 'sk-test' }, fetch });

    const result = await client.synthesize('hello world', outPath, { voice: 'alloy' });

    assert.equal(result.engine, 'openai');
    assert.equal(result.outPath, outPath);
    assert.deepEqual([...await fs.readFile(outPath)], [1, 2, 3]);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/speech');
    assert.equal(calls[0].body.model, 'gpt-4o-mini-tts');
    assert.equal(calls[0].body.input, 'hello world');
    assert.equal(calls[0].body.voice, 'alloy');
  });
});

test('TTS chunks long input and concatenates OpenAI response bytes', async () => {
  await withTempFile(async (outPath) => {
    const { fetch, calls } = stubFetch([new Uint8Array([1]), new Uint8Array([2])]);
    const client = createTtsClient({ engine: 'openai', apiKeys: { openai: 'sk-test' }, fetch, maxChunkChars: 5 });

    await client.synthesize('hello world', outPath);

    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.body.input), ['hello', 'world']);
    assert.deepEqual([...await fs.readFile(outPath)], [1, 2]);
  });
});

test('TTS auto falls through to local say when no API keys exist', async () => {
  await withoutTtsEnv(async () => withTempFile(async (outPath) => {
    const spawnCalls: Array<{ command: string; args: string[]; input?: string }> = [];
    const client = createTtsClient({
      engine: 'auto',
      apiKeys: {},
      hasCommand: (command) => command === 'say',
      spawn: async (command, args, input) => {
        spawnCalls.push({ command, args, input });
        await fs.writeFile(resultPath(outPath, '.aiff'), Buffer.from([9, 9]));
      },
    });

    const result = await client.synthesize('local words', outPath);

    assert.equal(result.engine, 'say');
    assert.equal(result.outPath, resultPath(outPath, '.aiff'));
    assert.equal(spawnCalls[0].command, 'say');
    assert.deepEqual(spawnCalls[0].args, ['--file-format=AIFF', '-o', resultPath(outPath, '.aiff')]);
    assert.equal(spawnCalls[0].input, 'local words');
    assert.deepEqual([...await fs.readFile(result.outPath)], [9, 9]);
  }));
});

test('TTS piper sends text on stdin and writes wav output', async () => {
  await withTempFile(async (outPath) => {
    const spawnCalls: Array<{ command: string; args: string[]; input?: string }> = [];
    const client = createTtsClient({
      engine: 'piper',
      hasCommand: (command) => command === 'piper',
      spawn: async (command, args, input) => {
        spawnCalls.push({ command, args, input });
        await fs.writeFile(resultPath(outPath, '.wav'), Buffer.from([8, 8]));
      },
    });

    const result = await client.synthesize('piper words', outPath);

    assert.equal(result.engine, 'piper');
    assert.equal(result.outPath, resultPath(outPath, '.wav'));
    assert.equal(spawnCalls[0].command, 'piper');
    assert.deepEqual(spawnCalls[0].args, ['--output_file', resultPath(outPath, '.wav')]);
    assert.equal(spawnCalls[0].input, 'piper words');
    assert.deepEqual([...await fs.readFile(result.outPath)], [8, 8]);
  });
});

test('TTS throws typed error when no engine is available', async () => {
  await withoutTtsEnv(async () => withTempFile(async (outPath) => {
    const client = createTtsClient({ engine: 'auto', apiKeys: {}, hasCommand: () => false });

    await assert.rejects(client.synthesize('hello', outPath), TtsUnavailableError);
  }));
});

function resultPath(filePath: string, extension: string): string {
  return path.join(path.dirname(filePath), `${path.basename(filePath, path.extname(filePath))}${extension}`);
}

async function withoutTtsEnv<T>(fn: () => Promise<T>): Promise<T> {
  const previous = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try { return await fn(); }
  finally {
    if (previous.OPENAI_API_KEY === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous.OPENAI_API_KEY;
    if (previous.GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous.GEMINI_API_KEY;
  }
}
