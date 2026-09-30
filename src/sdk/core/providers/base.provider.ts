import { GenerateRequest, GenerateResponse, GenerateChunk } from './provider.types';

/**
 * Common interface every provider adapter implements. Chains/agents/RAG in
 * this SDK only ever talk to this interface (via the ModelRouter) — never to
 * a vendor SDK or LangChain chat model directly.
 */
export interface LLMProvider {
  readonly name: string;
  readonly supportsEmbedding: boolean;

  generate(request: GenerateRequest): Promise<GenerateResponse>;
  stream(request: GenerateRequest): AsyncIterable<GenerateChunk>;
  embed?(texts: string[]): Promise<number[][]>;
}

/** Thrown by a provider adapter on a transient failure (rate limit, 5xx, timeout, quota exhaustion) so the
 * ModelRouter knows it's safe to retry / fall back to the next provider. */
export class ProviderTransientError extends Error {
  constructor(
    public readonly provider: string,
    cause: unknown,
    public readonly isExhausted = false,
  ) {
    super(
      `[${provider}] ${isExhausted ? 'quota exhausted' : 'transient failure'}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'ProviderTransientError';
  }
}

