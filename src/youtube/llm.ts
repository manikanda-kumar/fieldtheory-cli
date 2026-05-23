import type { ResolvedEngine } from '../engine.js';
import { invokeEngineAsync } from '../engine.js';
import type { ChatOptions, ChatResult, VisionChatOptions } from '../llm/openrouter-client.js';

export interface YoutubeLlmClient {
  chat<T = unknown>(options: ChatOptions): Promise<ChatResult<T>>;
  chatVision?<T = unknown>(options: VisionChatOptions): Promise<ChatResult<T>>;
}

export type EngineInvoker = (engine: ResolvedEngine, prompt: string) => Promise<string>;

export function createEngineYoutubeLlmClient(engine: ResolvedEngine, invoke: EngineInvoker = invokeEngineAsync): YoutubeLlmClient {
  return {
    async chat<T = unknown>(options: ChatOptions): Promise<ChatResult<T>> {
      const prompt = renderEnginePrompt(options);
      const text = await invoke(engine, prompt);
      return {
        text,
        model: engine.label,
        json: (options.json || options.jsonSchema) ? parseJson<T>(text) : undefined,
      };
    },
  };
}

export function createFallbackYoutubeLlmClient(primary: YoutubeLlmClient, fallback: YoutubeLlmClient): YoutubeLlmClient {
  return {
    async chat<T = unknown>(options: ChatOptions): Promise<ChatResult<T>> {
      try {
        return await primary.chat<T>(options);
      } catch {
        return fallback.chat<T>(options);
      }
    },
    ...(fallback.chatVision ? { chatVision: fallback.chatVision.bind(fallback) } : {}),
  };
}

function renderEnginePrompt(options: ChatOptions): string {
  const sections = [
    options.system ? `System:\n${options.system}` : '',
    ...options.messages.map((message) => `${message.role}:\n${renderMessageContent(message.content)}`),
    (options.json || options.jsonSchema) ? 'Return valid JSON only. Do not wrap the JSON in prose.' : '',
  ].filter(Boolean);
  return sections.join('\n\n---\n\n');
}

function renderMessageContent(content: ChatOptions['messages'][number]['content']): string {
  if (typeof content === 'string') return content;
  return content.map((part) => part.type === 'text' ? part.text : '[image omitted: local engine adapter is text-only]').join('\n');
}

function parseJson<T>(text: string): T {
  const direct = tryParseJson<T>(text.trim());
  if (direct.ok) return direct.value;

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParseJson<T>(fenced[1].trim());
    if (parsed.ok) return parsed.value;
  }

  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    const parsed = tryParseJson<T>(text.slice(objectStart, objectEnd + 1));
    if (parsed.ok) return parsed.value;
  }

  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    const parsed = tryParseJson<T>(text.slice(arrayStart, arrayEnd + 1));
    if (parsed.ok) return parsed.value;
  }

  throw new Error('Local engine response did not contain valid JSON');
}

function tryParseJson<T>(text: string): { ok: true; value: T } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false };
  }
}
