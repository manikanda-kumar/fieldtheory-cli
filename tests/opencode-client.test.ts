import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenCodeClient, OpenCodeRequestError } from '../src/llm/opencode-client.js';

test('OpenCode client uses message.content and defaults enough tokens for reasoning models', async () => {
  let request: Record<string, unknown> | undefined;
  const client = createOpenCodeClient({
    apiKey: 'test-key',
    fetch: async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { reasoning_content: 'private reasoning', content: 'final answer' } }] }));
    },
  });
  const result = await client.chat({ prompt: 'summarize' });
  assert.equal(result.text, 'final answer');
  assert.equal(request?.model, 'deepseek-v4-flash');
  assert.equal(request?.max_tokens, 2000);
});

test('OpenCode client rejects reasoning-only responses', async () => {
  const client = createOpenCodeClient({
    apiKey: 'test-key',
    fetch: async () => new Response(JSON.stringify({ choices: [{ message: { reasoning_content: 'private reasoning', content: '' } }] })),
  });
  await assert.rejects(() => client.chat({ prompt: 'summarize' }), OpenCodeRequestError);
});

test('OpenCode client aborts a stalled completion request', async () => {
  let aborted = false;
  const client = createOpenCodeClient({
    apiKey: 'test-key',
    timeoutMs: 5,
    fetch: async (_url, init) => {
      init?.signal?.addEventListener('abort', () => { aborted = true; });
      return new Promise<Response>(() => {});
    },
  });
  await assert.rejects(() => client.chat({ prompt: 'summarize' }), /timed out/);
  assert.equal(aborted, true);
});
