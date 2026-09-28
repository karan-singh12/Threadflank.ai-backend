import { ProviderTransientError } from './base.provider';

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function isRetryable(error: unknown): boolean {
  const status = (error as any)?.status ?? (error as any)?.response?.status;
  if (typeof status === 'number') return RETRYABLE_STATUS.has(status);
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message.includes('timeout') || message.includes('rate limit') || message.includes('econnreset');
}

/** Wraps a provider call with a small exponential-backoff retry for transient errors only. */
export async function withRetry<T>(providerName: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === attempts - 1) {
        throw new ProviderTransientError(providerName, error);
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * Math.pow(2, attempt)));
    }
  }
  throw new ProviderTransientError(providerName, lastError);
}
