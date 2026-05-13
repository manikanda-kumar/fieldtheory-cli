import { readFile } from 'node:fs/promises';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODELS = ['openai/gpt-4o-mini', 'google/gemini-2.5-flash'];
const DEFAULT_VISION_MODELS = ['openai/gpt-4o', 'google/gemini-2.5-flash'];

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
};

export interface OpenRouterClientOptions {
  apiKey?: string;
  primaryModel?: string;
  fallbackModels?: string[];
  visionPrimaryModel?: string;
  visionFallbackModels?: string[];
  fetch?: FetchFn;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface ChatOptions {
  system?: string;
  messages: OpenRouterMessage[];
  json?: boolean;
  jsonSchema?: unknown;
  maxTokens?: number;
  temperature?: number;
}

export interface VisionChatOptions {
  system?: string;
  prompt: string;
  images: Array<{ dataUrl?: string; path?: string }>;
  json?: boolean;
  jsonSchema?: unknown;
  maxTokens?: number;
  temperature?: number;
}

export interface ChatResult<T = unknown> {
  text: string;
  json?: T;
  model: string;
}

export class OpenRouterAuthError extends Error {
  constructor(message = 'OPENROUTER_API_KEY is required for OpenRouter requests') {
    super(message);
    this.name = 'OpenRouterAuthError';
  }
}

export class OpenRouterRequestError extends Error {
  constructor(message: string, readonly status?: number, readonly model?: string) {
    super(message);
    this.name = 'OpenRouterRequestError';
  }
}

export interface OpenRouterClient {
  chat<T = unknown>(options: ChatOptions): Promise<ChatResult<T>>;
  chatVision<T = unknown>(options: VisionChatOptions): Promise<ChatResult<T>>;
}

export function createOpenRouterClient(options: OpenRouterClientOptions = {}): OpenRouterClient {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const maxRetries = options.maxRetries ?? 2;
  const retryDelayMs = options.retryDelayMs ?? 250;
  const modelChain = [options.primaryModel, ...(options.fallbackModels ?? DEFAULT_MODELS.slice(1))]
    .filter(Boolean) as string[];
  if (!options.primaryModel) modelChain.unshift(DEFAULT_MODELS[0]);
  const visionModelChain = [options.visionPrimaryModel, ...(options.visionFallbackModels ?? DEFAULT_VISION_MODELS.slice(1))]
    .filter(Boolean) as string[];
  if (!options.visionPrimaryModel) visionModelChain.unshift(DEFAULT_VISION_MODELS[0]);

  const apiKey = () => options.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim() || '';

  async function chat<T = unknown>(chatOptions: ChatOptions): Promise<ChatResult<T>> {
    const messages = chatOptions.system
      ? [{ role: 'system' as const, content: chatOptions.system }, ...chatOptions.messages]
      : chatOptions.messages;
    return requestWithFallback<T>(modelChain, messages, chatOptions);
  }

  async function chatVision<T = unknown>(visionOptions: VisionChatOptions): Promise<ChatResult<T>> {
    const imageParts = await Promise.all(visionOptions.images.map(async (image) => ({
      type: 'image_url' as const,
      image_url: { url: image.dataUrl ?? await imagePathToDataUrl(image.path) },
    })));
    const messages: OpenRouterMessage[] = [
      ...(visionOptions.system ? [{ role: 'system' as const, content: visionOptions.system }] : []),
      { role: 'user', content: [{ type: 'text', text: visionOptions.prompt }, ...imageParts] },
    ];
    return requestWithFallback<T>(visionModelChain, messages, visionOptions);
  }

  async function requestWithFallback<T>(
    models: string[],
    messages: OpenRouterMessage[],
    requestOptions: Pick<ChatOptions, 'json' | 'jsonSchema' | 'maxTokens' | 'temperature'>,
  ): Promise<ChatResult<T>> {
    const key = apiKey();
    if (!key) throw new OpenRouterAuthError();

    let lastError: unknown;
    for (const model of models) {
      try {
        const text = await requestModel(model, key, messages, requestOptions);
        if (!text.trim()) throw new OpenRouterRequestError('OpenRouter returned an empty completion', undefined, model);
        return {
          text,
          model,
          json: (requestOptions.json || requestOptions.jsonSchema) ? JSON.parse(text) as T : undefined,
        };
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new OpenRouterRequestError('OpenRouter request failed for all models');
  }

  async function requestModel(
    model: string,
    key: string,
    messages: OpenRouterMessage[],
    requestOptions: Pick<ChatOptions, 'json' | 'jsonSchema' | 'maxTokens' | 'temperature'>,
  ): Promise<string> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const res = await fetchFn(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildRequestBody(model, messages, requestOptions)),
        });

        const bodyText = await res.text();
        const body = parseJsonObject(bodyText);
        if (!res.ok) {
          const message = extractErrorMessage(body) ?? `OpenRouter request failed with HTTP ${res.status}`;
          throw new OpenRouterRequestError(message, res.status, model);
        }

        return extractCompletionText(body);
      } catch (error) {
        lastError = error;
        if (!(error instanceof OpenRouterRequestError) || !isRetryableStatus(error.status) || attempt >= maxRetries) {
          throw error;
        }
        await sleep(retryDelayMs * Math.pow(2, attempt));
      }
    }

    if (lastError instanceof Error) throw lastError;
    throw new OpenRouterRequestError('OpenRouter request failed', undefined, model);
  }

  return { chat, chatVision };
}

function buildRequestBody(
  model: string,
  messages: OpenRouterMessage[],
  options: Pick<ChatOptions, 'json' | 'jsonSchema' | 'maxTokens' | 'temperature'>,
): Record<string, unknown> {
  return {
    model,
    messages,
    ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.json || options.jsonSchema ? { response_format: { type: 'json_object' } } : {}),
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text);
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function extractErrorMessage(body: Record<string, unknown>): string | undefined {
  const error = body.error;
  if (error != null && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return undefined;
}

function extractCompletionText(body: Record<string, unknown>): string {
  const choices = body.choices;
  if (!Array.isArray(choices)) return '';
  const first = choices[0];
  if (first == null || typeof first !== 'object' || !('message' in first)) return '';
  const message = first.message;
  if (message == null || typeof message !== 'object' || !('content' in message)) return '';
  return typeof message.content === 'string' ? message.content : '';
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (status !== undefined && status >= 500);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function imagePathToDataUrl(imagePath: string | undefined): Promise<string> {
  if (!imagePath) throw new Error('OpenRouter vision image requires either dataUrl or path');
  const data = await readFile(imagePath);
  const mime = imagePath.toLowerCase().endsWith('.jpg') || imagePath.toLowerCase().endsWith('.jpeg')
    ? 'image/jpeg'
    : 'image/png';
  return `data:${mime};base64,${data.toString('base64')}`;
}
