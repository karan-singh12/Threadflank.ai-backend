import { Injectable, Logger } from '@nestjs/common';
import { ClientFactory, ProviderNotConfiguredError } from '../client-factory';
import { ROUTER_CONFIG, modelForProvider } from './router-config';
import { ProviderName, RouteOverride, TaskType } from './router.types';
import { GenerateRequest, GenerateResponse } from '../providers/provider.types';
import { ProviderTransientError } from '../providers/base.provider';
import { isQuotaExhaustedError } from '../providers/retry.util';
import { AiRequestLoggerService } from '../../logging/ai-request-logger.service';
import { MESSAGES } from '../../../common/constants/messages.constant';

export interface RouterExecuteInput extends Omit<GenerateRequest, 'model'> {
  taskType: TaskType;
  override?: RouteOverride;
  requestedBy?: string;
}

/**
 * Picks a provider+model per request (explicit override > task-type routing >
 * default), executes it, and falls back across ROUTER_CONFIG.fallbackChain on
 * a hard failure or quota exhaustion. If Gemini is exhausted, requests fall back
 * to OpenRouter. A temporary cooldown deprioritizes exhausted providers so
 * subsequent requests don't waste round-trips waiting for a failing provider.
 */
@Injectable()
export class ModelRouter {
  private readonly logger = new Logger(ModelRouter.name);
  private readonly exhaustionCooldowns = new Map<ProviderName, number>();

  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly requestLogger: AiRequestLoggerService,
  ) {}

  private resolveInitialChoice(taskType: TaskType, override?: RouteOverride): { provider: ProviderName; model: string } {
    if (override?.provider) {
      return { provider: override.provider, model: override.model ?? modelForProvider(override.provider) };
    }
    const routed = ROUTER_CONFIG.taskRouting[taskType];
    if (routed) return routed;
    return { provider: ROUTER_CONFIG.defaultProvider, model: modelForProvider(ROUTER_CONFIG.defaultProvider) };
  }

  /**
   * The routed provider first, then the rest of the fallback chain in its configured order.
   * If a provider is currently marked exhausted, it is temporarily deprioritized to the
   * end of the candidate list so active providers (such as OpenRouter) serve requests immediately.
   */
  private fallbackOrder(startingFrom: ProviderName): ProviderName[] {
    const chain = [startingFrom, ...ROUTER_CONFIG.fallbackChain.filter((p) => p !== startingFrom)];
    const now = Date.now();
    const active = chain.filter((p) => (this.exhaustionCooldowns.get(p) ?? 0) <= now);
    const exhausted = chain.filter((p) => (this.exhaustionCooldowns.get(p) ?? 0) > now);
    return [...active, ...exhausted];
  }

  /** Checks if a provider is currently under exhaustion cooldown. */
  isProviderExhausted(provider: ProviderName): boolean {
    return (this.exhaustionCooldowns.get(provider) ?? 0) > Date.now();
  }

  /** Clear or set exhaustion status (useful for tests or operational resets). */
  setProviderExhausted(provider: ProviderName, exhausted: boolean, cooldownMs = 60_000): void {
    if (exhausted) {
      this.exhaustionCooldowns.set(provider, Date.now() + cooldownMs);
    } else {
      this.exhaustionCooldowns.delete(provider);
    }
  }

  async execute(input: RouterExecuteInput): Promise<GenerateResponse> {
    const initial = this.resolveInitialChoice(input.taskType, input.override);
    // If the caller forced a specific provider, honor it exactly — no silent fallback substitution.
    if (input.override?.provider && !this.clientFactory.isConfigured(input.override.provider)) {
      throw new ProviderNotConfiguredError(input.override.provider);
    }
    // Providers without an API key are skipped, so a task routed to e.g. Claude runs on the
    // next configured provider until ANTHROPIC_API_KEY is added.
    const candidates = (input.override?.provider ? [initial.provider] : this.fallbackOrder(initial.provider)).filter((p) =>
      this.clientFactory.isConfigured(p),
    );
    if (candidates.length === 0) {
      throw new Error(`${MESSAGES.sdk.providerFailure}: no LLM provider is configured (set GEMINI_API_KEY, OPENROUTER_API_KEY, GROQ_API_KEY, ANTHROPIC_API_KEY or OPENAI_API_KEY)`);
    }

    let lastError: unknown;

    for (const providerName of candidates) {
      const model = providerName === initial.provider ? initial.model : modelForProvider(providerName);
      const start = Date.now();

      try {
        const provider = this.clientFactory.get(providerName);
        const response = await provider.generate({
          messages: input.messages,
          model,
          tools: input.tools,
          temperature: input.temperature,
          maxTokens: input.maxTokens,
        });

        // Provider succeeded — clear any previous cooldown
        this.exhaustionCooldowns.delete(providerName);

        await this.requestLogger.log({
          provider: providerName,
          model,
          taskType: input.taskType,
          usage: response.usage,
          latencyMs: Date.now() - start,
          success: true,
          requestedBy: input.requestedBy,
        });

        return response;
      } catch (error) {
        lastError = error;
        const isExhausted =
          (error instanceof ProviderTransientError && error.isExhausted) || isQuotaExhaustedError(error);

        if (isExhausted) {
          const cooldownMs = parseInt(process.env.PROVIDER_COOLDOWN_MS || '60000', 10) || 60_000;
          this.exhaustionCooldowns.set(providerName, Date.now() + cooldownMs);
          this.logger.warn(`Provider [${providerName}] quota exhausted. Falling back across chain. Cooldown active for ${cooldownMs}ms.`);
        }

        await this.requestLogger.log({
          provider: providerName,
          model,
          taskType: input.taskType,
          latencyMs: Date.now() - start,
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
          requestedBy: input.requestedBy,
        });

        // Only a transient or quota-exhausted failure triggers fallback to the next provider.
        if (!(error instanceof ProviderTransientError) && !isExhausted) {
          throw error;
        }
      }
    }

    throw new Error(`${MESSAGES.sdk.providerFailure}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}
