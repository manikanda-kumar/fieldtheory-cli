const OPENCODE_URL = 'https://opencode.ai/zen/go/v1/chat/completions';
const DEFAULT_MODEL = 'deepseek-v4-flash';
const DEFAULT_MAX_TOKENS = 2000;

/**
 * True when the user has opted into disabling the reasoning model's thinking
 * stage via `FT_DEEPSEEK_NO_REASONING=1`. Verified against the OpenCode Go
 * proxy: passing `thinking: { type: 'disabled' }` returns plain text with no
 * `reasoning_content` and no billed `reasoning_tokens`. Faster + cheaper at a
 * small synthesis-quality cost.
 */
function thinkingDisabled(): boolean {
  const v = process.env.FT_DEEPSEEK_NO_REASONING?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

const THINKING_DISABLED_BODY = { thinking: { type: 'disabled' } };

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenCodeClientOptions {
  apiKey?: string;
  model?: string;
  fetch?: FetchFn;
  /** Abort a stalled completion request; defaults to 30 seconds. */
  timeoutMs?: number;
}

export interface OpenCodeChatOptions {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
}

export interface OpenCodeClient {
  chat(options: OpenCodeChatOptions): Promise<{ text: string; model: string }>;
}

export class OpenCodeAuthError extends Error {
  constructor() {
    super('OPENCODE_GO_API_KEY or OPENCODE_API_KEY is required for OpenCode requests');
    this.name = 'OpenCodeAuthError';
  }
}

export class OpenCodeRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'OpenCodeRequestError';
  }
}

export function openCodeApiKey(options: Pick<OpenCodeClientOptions, 'apiKey'> = {}): string {
  return options.apiKey?.trim() || process.env.OPENCODE_GO_API_KEY?.trim() || process.env.OPENCODE_API_KEY?.trim() || '';
}

/** Minimal OpenAI-compatible client for short link-enrichment completions. */
export function createOpenCodeClient(options: OpenCodeClientOptions = {}): OpenCodeClient {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const model = options.model?.trim() || process.env.FT_ENRICH_MODEL?.trim() || DEFAULT_MODEL;
  const timeoutMs = Math.max(1, options.timeoutMs ?? 30_000);

  return {
    async chat(chatOptions) {
      const key = openCodeApiKey(options);
      if (!key) throw new OpenCodeAuthError();
      // deepseek-v4-flash reasons before answering; a 2k default reserves room
      // for both reasoning and the final message.content answer.
      // only reasoning_content and an empty message.content.
      const controller = new AbortController();
      const request = fetchFn(OPENCODE_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: chatOptions.prompt }],
          max_tokens: Math.max(600, chatOptions.maxTokens ?? DEFAULT_MAX_TOKENS),
          ...(chatOptions.temperature === undefined ? {} : { temperature: chatOptions.temperature }),
          ...(thinkingDisabled() ? THINKING_DISABLED_BODY : {}),
        }),
      });
      const res = await raceWithTimeout(request, controller, timeoutMs);
      const body = parseObject(await res.text());
      if (!res.ok) throw new OpenCodeRequestError(errorMessage(body) ?? `OpenCode request failed with HTTP ${res.status}`, res.status);
      const text = completionText(body);
      if (!text.trim()) throw new OpenCodeRequestError('OpenCode returned an empty completion');
      return { text, model };
    },
  };
}

async function raceWithTimeout(request: Promise<Response>, controller: AbortController, timeoutMs: number): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<Response>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new OpenCodeRequestError(`OpenCode request timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      request.then(resolve, reject);
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseObject(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return value != null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function errorMessage(body: Record<string, unknown>): string | undefined {
  const error = body.error;
  return error != null && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : undefined;
}

function completionText(body: Record<string, unknown>): string {
  const first = Array.isArray(body.choices) ? body.choices[0] : null;
  if (first == null || typeof first !== 'object' || !('message' in first)) return '';
  const message = first.message;
  // Deliberately ignore reasoning_content: it is model scratch work, not the answer.
  return message != null && typeof message === 'object' && 'content' in message && typeof message.content === 'string' ? message.content : '';
}
