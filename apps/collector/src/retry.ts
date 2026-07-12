/**
 * Exponential backoff for collector ingest POSTs (rate limits + transient errors).
 */

export interface BackoffOptions {
  /** Total attempts including the first try. Default 5. */
  maxAttempts?: number;
  /** Initial delay before first retry. Default 500ms. */
  initialDelayMs?: number;
  /** Cap on delay between attempts. Default 30s. */
  maxDelayMs?: number;
  /** Multiplier per attempt. Default 2. */
  factor?: number;
  /** Optional jitter fraction 0–1 applied to delay. Default 0.2. */
  jitter?: number;
  /** Return true to retry. Default: network / 408 / 429 / 5xx. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Called before sleeping. */
  onRetry?: (info: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }) => void;
}

export interface RetryableResult {
  ok: boolean;
  status: number;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultShouldRetry(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status: unknown }).status);
    if (status === 0) return true; // network / fetch throw mapped to status 0
    if (status === 408 || status === 429) return true;
    if (status >= 500 && status < 600) return true;
    return false;
  }
  return true;
}

function computeDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  factor: number,
  jitter: number,
): number {
  const base = Math.min(
    maxDelayMs,
    initialDelayMs * Math.pow(factor, Math.max(0, attempt - 1)),
  );
  if (jitter <= 0) return Math.floor(base);
  const spread = base * jitter;
  return Math.floor(base - spread / 2 + Math.random() * spread);
}

/**
 * Run `fn` with exponential backoff until it succeeds or attempts are exhausted.
 * `fn` should throw or return a result; for ingest, prefer wrapping IngestResult.
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  isSuccess: (value: T) => boolean,
  options: BackoffOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const factor = options.factor ?? 2;
  const jitter = options.jitter ?? 0.2;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let last: T | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      last = await fn();
      if (isSuccess(last)) return last;
      lastError = last;
      if (attempt >= maxAttempts || !shouldRetry(last, attempt)) {
        return last;
      }
      const delayMs = computeDelay(
        attempt,
        initialDelayMs,
        maxDelayMs,
        factor,
        jitter,
      );
      options.onRetry?.({ attempt, delayMs, error: last });
      await sleep(delayMs);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !shouldRetry(err, attempt)) {
        throw err;
      }
      const delayMs = computeDelay(
        attempt,
        initialDelayMs,
        maxDelayMs,
        factor,
        jitter,
      );
      options.onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs);
    }
  }

  if (last !== undefined) return last;
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "withBackoff exhausted"));
}

/** True when an ingest-style result should be retried. */
export function isRetryableIngestResult(result: RetryableResult): boolean {
  if (result.ok) return false;
  return defaultShouldRetry(result);
}
