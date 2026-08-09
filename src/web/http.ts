import type { IncomingMessage, ServerResponse } from 'node:http';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function safeRoutePath(rawUrl: string | undefined): string {
  try {
    return decodeURIComponent(new URL(rawUrl ?? '/', 'http://127.0.0.1').pathname);
  } catch {
    return '/';
  }
}

export function requestUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://127.0.0.1');
}

export function parseBoundedInteger(
  value: string | null,
  options: { defaultValue: number; min: number; max: number },
): number {
  if (value == null || value.trim() === '') return options.defaultValue;
  if (!/^\d+$/.test(value.trim())) throw new HttpError(400, `Invalid integer: ${value}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < options.min) throw new HttpError(400, `Invalid integer: ${value}`);
  return Math.min(parsed, options.max);
}

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

export function sendText(
  res: ServerResponse,
  statusCode: number,
  body: string,
  contentType = 'text/plain; charset=utf-8',
): void {
  res.writeHead(statusCode, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

export interface SseStream {
  send(event: string, data: unknown): void;
  comment(text: string): void;
  close(): void;
}

/** Open a server-sent-events response. Callers own the stream until close(). */
export function openSse(res: ServerResponse): SseStream {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-content-type-options': 'nosniff',
  });
  let closed = false;
  return {
    send(event, data) {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    comment(text) {
      if (closed) return;
      res.write(`: ${text}\n\n`);
    },
    close() {
      if (closed) return;
      closed = true;
      res.end();
    },
  };
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof HttpError) {
    sendJson(res, error.statusCode, { error: error.message });
    return;
  }
  console.error(error);
  sendJson(res, 500, { error: 'Internal server error' });
}