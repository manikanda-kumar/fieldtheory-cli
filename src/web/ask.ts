/**
 * "Ask library" route: streams an `ft ask` run to the browser over SSE.
 *
 * The answer takes tens of seconds (agentic CLI call), so progress lines from
 * askMd are forwarded as they happen instead of blocking on one JSON response.
 */

import type { ServerResponse } from 'node:http';
import { askMd, type AskResult } from '../md-ask.js';
import { detectAvailableEngines } from '../engine.js';
import { loadPreferences } from '../preferences.js';
import { HttpError, openSse } from './http.js';

export type AskFn = (question: string, options: {
  save?: boolean;
  onProgress?: (status: string) => void;
  profile?: { engine?: string };
}) => Promise<AskResult>;

const MAX_QUESTION_LENGTH = 2000;
const HEARTBEAT_MS = 15_000;

/**
 * Pick an engine without touching stdin. resolveEngine() prompts interactively
 * when several CLIs are installed and no default is saved — that would hang the
 * request forever, so the server always names one.
 */
export function pickNonInteractiveEngine(): string | undefined {
  const available = detectAvailableEngines();
  if (available.length === 0) return undefined;
  const preferred = loadPreferences().defaultEngine;
  if (preferred && available.includes(preferred)) return preferred;
  return available[0];
}

/** One ask at a time: each run spawns an LLM CLI child process. */
let inFlight = false;

export function parseAskRequest(url: URL): { question: string; save: boolean } {
  const question = url.searchParams.get('query')?.trim() ?? '';
  if (!question) throw new HttpError(400, 'Missing query');
  if (question.length > MAX_QUESTION_LENGTH) throw new HttpError(400, 'Question too long');
  return { question, save: url.searchParams.get('save') === '1' };
}

export interface AskDeps {
  ask?: AskFn;
  pickEngine?: () => string | undefined;
}

export async function handleAsk(res: ServerResponse, url: URL, deps: AskDeps = {}): Promise<void> {
  const ask = deps.ask ?? askMd;
  const { question, save } = parseAskRequest(url);
  if (inFlight) throw new HttpError(429, 'Another question is already running');

  const engine = (deps.pickEngine ?? pickNonInteractiveEngine)();
  if (!engine) throw new HttpError(503, 'No LLM engine found. Install claude, codex, grok, or agy, or set OPENCODE_GO_API_KEY.');

  inFlight = true;
  const stream = openSse(res);
  const heartbeat = setInterval(() => stream.comment('keepalive'), HEARTBEAT_MS);
  try {
    stream.send('progress', { message: `Using ${engine}…` });
    const result = await ask(question, {
      save,
      profile: { engine },
      onProgress: (message) => stream.send('progress', { message }),
    });
    stream.send('done', result);
  } catch (error) {
    stream.send('error', { error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearInterval(heartbeat);
    stream.close();
    inFlight = false;
  }
}

/** Test hook: clears the single-flight latch between cases. */
export function resetAskInFlightForTest(): void {
  inFlight = false;
}
