export interface RetryOptions {
  signal?: AbortSignal;
  max_attempts?: number;
  initial_delay_ms?: number;
}

export type ClientIdFactory = () => string;

export function defaultClientIdFactory(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new Error('crypto.randomUUID() is required for WebMCP write idempotency');
  }
  return globalThis.crypto.randomUUID();
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Operation aborted');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  throwIfAborted(signal);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal ? abortReason(signal) : new Error('Operation aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Retries transport failures inside the page callback while preserving the
 * same client-generated operation identifier across every attempt. Business
 * results are returned unchanged and are never retried here.
 */
export async function withStableClientIdRetry<T>(
  operation: (clientId: string) => Promise<T>,
  idFactory: ClientIdFactory = defaultClientIdFactory,
  options: RetryOptions = {},
): Promise<T> {
  const clientId = idFactory();
  const maxAttempts = Math.max(1, options.max_attempts ?? 3);
  const initialDelayMs = Math.max(0, options.initial_delay_ms ?? 75);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(options.signal);
    try {
      return await operation(clientId);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
      await abortableDelay(initialDelayMs * 2 ** (attempt - 1), options.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Retry loop exhausted');
}
