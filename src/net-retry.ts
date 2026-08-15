/**
 * Shared transient-network retry for unattended syncs.
 *
 * The nightly `sync-all` run loses whole steps to one-off socket faults:
 * undici surfaces them as `TypeError: terminated` (YouTube watch/caption
 * fetches) or `This operation was aborted` (RSS feeds that blew the fetch
 * timeout), and every one of them succeeds on a manual re-run minutes later.
 * Retrying in place is far cheaper than letting the step exit non-zero and
 * having `sync-all` replay the entire command.
 */

export interface RetryTransientOptions {
  /** Total attempts including the first. Default: 3. */
  attempts?: number;
  /** Backoff before the first retry; each further wait triples it. Default: 1s. */
  baseDelayMs?: number;
  /** Clock injection for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Extra predicate OR-ed with the built-in transient check. */
  isRetryable?: (error: unknown) => boolean;
}

const TRANSIENT_RE = /terminated|fetch failed|econnreset|econnrefused|etimedout|epipe|eai_again|socket hang up|und_err|operation was aborted|aborterror|the operation was aborted|network error|timed out|\b429\b|\b5\d\d\b/;

/** True for socket/DNS/timeout faults that are worth replaying as-is. */
export function isTransientNetworkError(error: unknown): boolean {
  const message = (error instanceof Error ? `${error.name}: ${error.message} ${String((error as { code?: string }).code ?? '')}` : String(error)).toLowerCase();
  return TRANSIENT_RE.test(message);
}

export async function retryTransient<T>(
  operation: () => Promise<T>,
  options: RetryTransientOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 1_000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = isTransientNetworkError(error) || Boolean(options.isRetryable?.(error));
      if (!retryable || attempt === attempts) throw error;
      // Backoff triples per attempt: 1s, then 3s (plus jitter).
      await sleep(baseDelayMs * 3 ** (attempt - 1) + Math.floor(Math.random() * 250));
    }
  }
  throw lastError;
}
