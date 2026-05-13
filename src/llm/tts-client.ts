import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';
import { hasCommandOnPath } from '../engine.js';

const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const DEFAULT_MAX_CHUNK_CHARS = 4000;

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
export type TtsEngine = 'openai' | 'gemini' | 'say' | 'piper' | 'auto';
type ConcreteTtsEngine = Exclude<TtsEngine, 'auto'>;
type SpawnFn = (command: string, args: string[]) => Promise<void>;

export interface TtsClientOptions {
  engine?: TtsEngine;
  apiKeys?: { openai?: string; gemini?: string };
  fetch?: FetchFn;
  hasCommand?: (command: string) => boolean;
  spawn?: SpawnFn;
  maxChunkChars?: number;
}

export interface SynthesizeOptions {
  voice?: string;
  format?: 'mp3';
}

export interface SynthesizeResult {
  engine: ConcreteTtsEngine;
  outPath: string;
}

export interface TtsClient {
  synthesize(text: string, outPath: string, options?: SynthesizeOptions): Promise<SynthesizeResult>;
}

export class TtsUnavailableError extends Error {
  constructor(message = 'No TTS engine is available. Set OPENAI_API_KEY or choose an installed local engine.') {
    super(message);
    this.name = 'TtsUnavailableError';
  }
}

export class TtsRequestError extends Error {
  constructor(message: string, readonly engine: ConcreteTtsEngine) {
    super(message);
    this.name = 'TtsRequestError';
  }
}

export function createTtsClient(options: TtsClientOptions = {}): TtsClient {
  const engine = options.engine ?? 'auto';
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const hasCommand = options.hasCommand ?? ((command: string) => hasCommandOnPath(command));
  const spawn = options.spawn ?? spawnCommand;
  const maxChunkChars = options.maxChunkChars ?? DEFAULT_MAX_CHUNK_CHARS;

  const openaiKey = () => options.apiKeys ? options.apiKeys.openai?.trim() ?? '' : process.env.OPENAI_API_KEY?.trim() ?? '';
  const geminiKey = () => options.apiKeys ? options.apiKeys.gemini?.trim() ?? '' : process.env.GEMINI_API_KEY?.trim() ?? '';

  async function synthesize(text: string, outPath: string, synthOptions: SynthesizeOptions = {}): Promise<SynthesizeResult> {
    const selected = resolveEngine();
    await mkdir(path.dirname(outPath), { recursive: true });

    if (selected === 'openai') {
      await synthesizeOpenAi(text, outPath, synthOptions);
    } else if (selected === 'gemini') {
      await synthesizeGemini(text, outPath);
    } else if (selected === 'say') {
      await spawn('say', ['-o', outPath, text]);
    } else {
      await spawn('piper', ['--output_file', outPath],);
    }

    return { engine: selected, outPath };
  }

  function resolveEngine(): ConcreteTtsEngine {
    if (engine !== 'auto') {
      if (engine === 'openai' && !openaiKey()) throw new TtsUnavailableError('OPENAI_API_KEY is required for OpenAI TTS');
      if (engine === 'gemini' && !geminiKey()) throw new TtsUnavailableError('GEMINI_API_KEY is required for Gemini TTS');
      if ((engine === 'say' || engine === 'piper') && !hasCommand(engine)) throw new TtsUnavailableError(`TTS engine command not found on PATH: ${engine}`);
      return engine;
    }

    if (openaiKey()) return 'openai';
    if (hasCommand('say')) return 'say';
    if (hasCommand('piper')) return 'piper';
    throw new TtsUnavailableError();
  }

  async function synthesizeOpenAi(text: string, outPath: string, synthOptions: SynthesizeOptions): Promise<void> {
    const chunks = chunkText(text, maxChunkChars);
    const buffers: Buffer[] = [];
    for (const chunk of chunks) {
      const res = await fetchFn(OPENAI_TTS_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${openaiKey()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice: synthOptions.voice ?? 'alloy',
          input: chunk,
          response_format: synthOptions.format ?? 'mp3',
        }),
      });
      if (!res.ok) {
        const details = await res.text().catch(() => '');
        throw new TtsRequestError(`OpenAI TTS failed with HTTP ${res.status}${details ? `: ${details}` : ''}`, 'openai');
      }
      buffers.push(Buffer.from(await res.arrayBuffer()));
    }
    await writeFile(outPath, Buffer.concat(buffers));
  }

  async function synthesizeGemini(_text: string, _outPath: string): Promise<void> {
    throw new TtsRequestError('Gemini TTS is not implemented yet', 'gemini');
  }

  return { synthesize };
}

function chunkText(text: string, maxChunkChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= maxChunkChars) {
      current = `${current} ${word}`;
    } else {
      chunks.push(current);
      current = word;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [''];
}

function spawnCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new TtsRequestError(`${command} exited with ${code}${stderr ? `: ${stderr.trim()}` : ''}`, command as ConcreteTtsEngine));
    });
  });
}
