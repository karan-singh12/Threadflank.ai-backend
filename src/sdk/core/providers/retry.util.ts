import { ProviderTransientError } from './base.provider';

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function isQuotaExhaustedError(error: unknown): boolean {
  const status = (error as any)?.status ?? (error as any)?.response?.status ?? (error as any)?.code;
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (status === 429 || status === 402 || status === 403) {
    return true;
  }

  return (
    message.includes('429') ||
    message.includes('resource_exhausted') ||
    message.includes('resource has been exhausted') ||
    message.includes('quota exceeded') ||
    message.includes('exceeded your current quota') ||
    message.includes('rate limit') ||
    message.includes('rate-limit') ||
    message.includes('too many requests') ||
    message.includes('requires more credits') ||
    message.includes('insufficient_quota') ||
    message.includes('out of credits') ||
    message.includes('quota')
  );
}

export function isRetryable(error: unknown): boolean {
  const status = (error as any)?.status ?? (error as any)?.response?.status;
  if (typeof status === 'number') return RETRYABLE_STATUS.has(status);
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('timeout') || message.includes('rate limit') || message.includes('econnreset');
}

/** Wraps a provider call with a small exponential-backoff retry for transient errors only.
 * If quota is exhausted, fails fast immediately with isExhausted=true so the router can fall back without delay.
 */
export async function withRetry<T>(providerName: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Quota / exhaustion should fail fast without wasting retries, immediately triggering fallback
      if (isQuotaExhaustedError(error)) {
        throw new ProviderTransientError(providerName, error, true);
      }

      if (!isRetryable(error)) {
        // Non-transient error (e.g. 400 Bad Request) should be re-thrown directly
        throw error;
      }

      if (attempt === attempts - 1) {
        throw new ProviderTransientError(providerName, error, false);
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * Math.pow(2, attempt)));
    }
  }
  throw new ProviderTransientError(providerName, lastError, false);
}
