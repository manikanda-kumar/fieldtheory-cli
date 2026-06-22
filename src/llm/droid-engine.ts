/**
 * Droid engine — routes LLM calls through the OpenCode Go API.
 *
 * OpenCode Go is a low-cost subscription ($5 first month, then $10/month)
 * that provides reliable access to open coding models through OpenCode's own
 * API endpoint: https://opencode.ai/zen/go/v1/chat/completions
 *
 * This lets Field Theory treat cloud models as a first-class engine alongside
 * local CLI tools (claude, codex). Droid is available when OPENCODE_GO_API_KEY
 * is set, or when OpenCode auth credentials are found on disk.
 *
 * Default model chain (fastest → capable):
 *   1. deepseek-v4-flash  ($0.14 / $0.28 per 1M, 1M context)
 *   2. mimo-v2.5          ($0.14 / $0.28 per 1M, 256K context)
 *   3. deepseek-v4-pro    ($1.74 / $3.48 per 1M, 1M context)
 *
 * Override the primary model with FT_DROID_MODEL or --model.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const OPENCODE_GO_URL = 'https://opencode.ai/zen/go/v1/chat/completions';

const DROID_DEFAULT_CHAIN = [
  'deepseek-v4-flash',
  'mimo-v2.5',
  'deepseek-v4-pro',
];

export interface DroidEngineOptions {
  apiKey?: string;
  primaryModel?: string;
  fallbackModels?: string[];
  fetch?: typeof fetch;
}

interface OpenCodeAuthEntry {
  apiKey?: string;
  accessToken?: string;
  token?: string;
}

/** Read OpenCode Go API key from ~/.local/share/opencode/auth.json */
async function readOpenCodeAuth(): Promise<string | undefined> {
  try {
    const authPath = path.join(homedir(), '.local', 'share', 'opencode', 'auth.json');
    const raw = await readFile(authPath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, OpenCodeAuthEntry>;
    // OpenCode stores auth per-provider; look for the Go provider entry
    const goEntry = parsed['opencode-go'] ?? parsed['go'];
    if (goEntry?.apiKey) return goEntry.apiKey;
    // Fall back to any entry with an apiKey
    for (const entry of Object.values(parsed)) {
      if (entry?.apiKey) return entry.apiKey;
    }
  } catch {
    // auth file missing or unreadable
  }
  return undefined;
}

function resolveApiKey(options?: DroidEngineOptions): string | undefined {
  const envKey = process.env.OPENCODE_GO_API_KEY?.trim();
  if (envKey) return envKey;
  // Note: disk read is async; callers that need sync checks should use
  // isDroidAvailable() which only checks the env var.
  return options?.apiKey;
}

function resolveModelChain(options?: DroidEngineOptions): string[] {
  const envModel = typeof process !== 'undefined' ? process.env.FT_DROID_MODEL?.trim() : undefined;
  const chain = [
    options?.primaryModel ?? envModel,
    ...(options?.fallbackModels ?? DROID_DEFAULT_CHAIN.slice(1)),
  ].filter(Boolean) as string[];
  if (!options?.primaryModel && !envModel) {
    chain.unshift(DROID_DEFAULT_CHAIN[0]);
  }
  return chain;
}

async function requestModel(
  model: string,
  key: string,
  prompt: string,
  fetchFn: typeof fetch,
  systemPrompt?: string,
): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const res = await fetchFn(OPENCODE_GO_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
    }),
  });

  const bodyText = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    // leave empty
  }

  if (!res.ok) {
    const errorObj = body.error;
    const message =
      errorObj != null && typeof errorObj === 'object' && 'message' in errorObj && typeof errorObj.message === 'string'
        ? errorObj.message
        : `OpenCode Go request failed with HTTP ${res.status}`;
    throw new Error(message);
  }

  const choices = body.choices;
  if (!Array.isArray(choices)) throw new Error('OpenCode Go returned no choices');
  const first = choices[0];
  if (first == null || typeof first !== 'object' || !('message' in first)) {
    throw new Error('OpenCode Go returned empty completion');
  }
  const message = first.message;
  if (message == null || typeof message !== 'object' || !('content' in message)) {
    throw new Error('OpenCode Go returned empty completion');
  }
  return typeof message.content === 'string' ? message.content : '';
}

/** Format a raw prompt string as a chat completion and return the text. */
export async function invokeDroid(
  options: DroidEngineOptions | undefined,
  prompt: string,
  systemPrompt?: string,
): Promise<string> {
  const key = resolveApiKey(options) ?? (await readOpenCodeAuth());
  if (!key) {
    throw new Error(
      'OPENCODE_GO_API_KEY is required for the droid engine. ' +
        'Get your key from https://opencode.ai/auth (Go subscription) '
    );
  }

  const chain = resolveModelChain(options);
  const fetchFn = options?.fetch ?? globalThis.fetch.bind(globalThis);

  let lastError: unknown;
  for (const model of chain) {
    try {
      const text = await requestModel(model, key, prompt, fetchFn, systemPrompt);
      if (!text.trim()) throw new Error('OpenCode Go returned an empty completion');
      return text;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error('OpenCode Go request failed for all models');
}

/** True when OPENCODE_GO_API_KEY is set (fast sync check). */
export function isDroidAvailable(): boolean {
  const key = process.env.OPENCODE_GO_API_KEY?.trim();
  return Boolean(key && key.length > 0);
}

/** Return the resolved model chain for display/logging. */
export function getDroidModelChain(options?: DroidEngineOptions): string[] {
  return resolveModelChain(options);
}
