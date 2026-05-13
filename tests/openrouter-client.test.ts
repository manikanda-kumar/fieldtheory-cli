import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenRouterClient, OpenRouterAuthError } from '../src/llm/openrouter-client.js';

interface StubResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

function response(status: number, body: unknown): StubResponse {
  return { ok: status >= 200 && status < 300, status, body };
}

function stubFetch(responses: StubResponse[]) {
  const calls: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = [];
  const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch call');
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? '{}')) });
    return {
      ok: next.ok,
      status: next.status,
      statusText: String(next.status),
      text: async () => JSON.stringify(next.body),
      json: async () => next.body,
    } as Response;
  };
  return { fetch, calls };
}

test('OpenRouter chat posts messages and returns text', async () => {
  const { fetch, calls } = stubFetch([
    response(200, { choices: [{ message: { content: 'hello' } }] }),
  ]);
  const client = createOpenRouterClient({ apiKey: 'sk-test', fetch });

  const result = await client.chat({ system: 'Be brief', messages: [{ role: 'user', content: 'Hi' }] });

  assert.equal(result.text, 'hello');
  assert.equal(calls[0].url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, 'Bearer sk-test');
  assert.equal(calls[0].body.model, 'openai/gpt-4o-mini');
  assert.deepEqual(calls[0].body.messages, [
    { role: 'system', content: 'Be brief' },
    { role: 'user', content: 'Hi' },
  ]);
});

test('OpenRouter chat retries 429 and then succeeds', async () => {
  const { fetch, calls } = stubFetch([
    response(429, { error: { message: 'rate limited' } }),
    response(200, { choices: [{ message: { content: 'after retry' } }] }),
  ]);
  const client = createOpenRouterClient({ apiKey: 'sk-test', fetch, retryDelayMs: 0 });

  const result = await client.chat({ messages: [{ role: 'user', content: 'Hi' }] });

  assert.equal(result.text, 'after retry');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.model, 'openai/gpt-4o-mini');
  assert.equal(calls[1].body.model, 'openai/gpt-4o-mini');
});

test('OpenRouter chat falls back when primary model fails', async () => {
  const { fetch, calls } = stubFetch([
    response(400, { error: { message: 'bad model' } }),
    response(200, { choices: [{ message: { content: 'fallback' } }] }),
  ]);
  const client = createOpenRouterClient({
    apiKey: 'sk-test',
    fetch,
    primaryModel: 'primary/model',
    fallbackModels: ['fallback/model'],
  });

  const result = await client.chat({ messages: [{ role: 'user', content: 'Hi' }] });

  assert.equal(result.text, 'fallback');
  assert.deepEqual(calls.map((call) => call.body.model), ['primary/model', 'fallback/model']);
});

test('OpenRouter chat parses JSON when json mode is requested', async () => {
  const { fetch } = stubFetch([
    response(200, { choices: [{ message: { content: '{"ok":true}' } }] }),
  ]);
  const client = createOpenRouterClient({ apiKey: 'sk-test', fetch });

  const result = await client.chat<{ ok: boolean }>({ messages: [{ role: 'user', content: 'JSON' }], json: true });

  assert.equal(result.text, '{"ok":true}');
  assert.deepEqual(result.json, { ok: true });
});

test('OpenRouter vision sends image content and uses vision model chain', async () => {
  const { fetch, calls } = stubFetch([
    response(200, { choices: [{ message: { content: 'slides' } }] }),
  ]);
  const client = createOpenRouterClient({ apiKey: 'sk-test', fetch });

  const result = await client.chatVision({
    system: 'Classify frames',
    prompt: 'Are these slides?',
    images: [{ dataUrl: 'data:image/png;base64,abc' }],
  });

  assert.equal(result.text, 'slides');
  assert.equal(calls[0].body.model, 'openai/gpt-4o');
  const messages = calls[0].body.messages as Array<{ role: string; content: unknown }>;
  assert.equal(messages[1].role, 'user');
  assert.deepEqual(messages[1].content, [
    { type: 'text', text: 'Are these slides?' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
  ]);
});

test('OpenRouter client throws a typed error when API key is missing', async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    const client = createOpenRouterClient({ apiKey: '', fetch: async () => response(200, {}) as unknown as Response });
    await assert.rejects(
      client.chat({ messages: [{ role: 'user', content: 'Hi' }] }),
      OpenRouterAuthError,
    );
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});
