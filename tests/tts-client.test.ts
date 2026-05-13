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
  await withTempFile(async (outPath) => {
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const client = createTtsClient({
      engine: 'auto',
      apiKeys: {},
      hasCommand: (command) => command === 'say',
      spawn: async (command, args) => {
        spawnCalls.push({ command, args });
        await fs.writeFile(outPath, Buffer.from([9, 9]));
      },
    });

    const result = await client.synthesize('local words', outPath);

    assert.equal(result.engine, 'say');
    assert.equal(spawnCalls[0].command, 'say');
    assert.deepEqual([...await fs.readFile(outPath)], [9, 9]);
  });
});

test('TTS throws typed error when no engine is available', async () => {
  await withTempFile(async (outPath) => {
    const client = createTtsClient({ engine: 'auto', apiKeys: {}, hasCommand: () => false });

    await assert.rejects(client.synthesize('hello', outPath), TtsUnavailableError);
  });
});
