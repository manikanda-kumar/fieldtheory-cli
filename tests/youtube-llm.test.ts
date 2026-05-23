import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngineYoutubeLlmClient, createFallbackYoutubeLlmClient } from '../src/youtube/llm.js';
import type { ResolvedEngine } from '../src/engine.js';

const engine: ResolvedEngine = {
  name: 'claude',
  model: 'opus',
  effort: 'medium',
  label: 'claude/opus/effort=medium',
  config: { bin: 'claude', args: () => [] },
};

test('createEngineYoutubeLlmClient invokes the selected Field Theory engine and parses JSON', async () => {
  let prompt = '';
  const client = createEngineYoutubeLlmClient(engine, async (resolved, input) => {
    assert.equal(resolved, engine);
    prompt = input;
    return '```json\n{"ok":true,"items":["a"]}\n```';
  });

  const result = await client.chat<{ ok: boolean; items: string[] }>({
    system: 'System message',
    json: true,
    messages: [{ role: 'user', content: 'User message' }],
  });

  assert.equal(result.model, 'claude/opus/effort=medium');
  assert.deepEqual(result.json, { ok: true, items: ['a'] });
  assert.match(prompt, /System message/);
  assert.match(prompt, /User message/);
  assert.match(prompt, /Return valid JSON only/i);
});

test('createFallbackYoutubeLlmClient uses OpenRouter fallback when local engine chat fails', async () => {
  const calls: string[] = [];
  const local = createEngineYoutubeLlmClient(engine, async () => {
    calls.push('local');
    throw new Error('local engine unavailable');
  });
  const fallback = {
    chat: async () => {
      calls.push('openrouter');
      return { text: '{"ok":true}', json: { ok: true }, model: 'openrouter-model' };
    },
  };

  const client = createFallbackYoutubeLlmClient(local, fallback);
  const result = await client.chat<{ ok: boolean }>({ messages: [{ role: 'user', content: 'hello' }], json: true });

  assert.deepEqual(calls, ['local', 'openrouter']);
  assert.deepEqual(result.json, { ok: true });
  assert.equal(result.model, 'openrouter-model');
});

test('createFallbackYoutubeLlmClient delegates vision to OpenRouter fallback', async () => {
  const client = createFallbackYoutubeLlmClient(createEngineYoutubeLlmClient(engine, async () => 'ok'), {
    chat: async () => ({ text: '{}', json: {}, model: 'fallback-chat' }),
    chatVision: async () => ({ text: '{"isSlides":true}', json: { isSlides: true }, model: 'fallback-vision' }),
  });

  assert.ok(client.chatVision, 'vision method should be available from fallback');
  const result = await client.chatVision({ prompt: 'look', images: [], json: true });
  assert.deepEqual(result.json, { isSlides: true });
  assert.equal(result.model, 'fallback-vision');
});
