import { Injectable } from '@nestjs/common';
import { LLMProvider } from './providers/base.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { ClaudeProvider } from './providers/claude.provider';
import { OpenAICompatibleProvider } from './providers/openai-compatible.provider';
import { PROVIDER_NAMES, ProviderName } from './router/router.types';

const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** The env var holding each provider's API key. A provider without one is skipped by the router. */
export const PROVIDER_KEY_ENV: Record<ProviderName, string> = {
  gemini: 'GEMINI_API_KEY',
  claude: 'ANTHROPIC_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
};

/** Thrown when a provider is asked for but its API key isn't set. */
export class ProviderNotConfiguredError extends Error {
  constructor(public readonly provider: ProviderName) {
    super(`${PROVIDER_KEY_ENV[provider]} is not configured`);
    this.name = 'ProviderNotConfiguredError';
  }
}

/** Groq's OpenAI-compatible API lives under /openai/v1; GROQ_API_BASE_URL may be the bare host. */
function groqBaseUrl() {
  const base = (process.env.GROQ_API_BASE_URL || 'https://api.groq.com').replace(/\/+$/, '');
  return base.endsWith('/openai/v1') ? base : `${base}/openai/v1`;
}

/** Constructs and memoizes provider adapter instances from env config. */
@Injectable()
export class ClientFactory {
  private readonly instances = new Map<ProviderName, LLMProvider>();

  isConfigured(provider: ProviderName): boolean {
    return Boolean(process.env[PROVIDER_KEY_ENV[provider]]?.trim());
  }

  configuredProviders(): ProviderName[] {
    return PROVIDER_NAMES.filter((p) => this.isConfigured(p));
  }

  get(provider: ProviderName): LLMProvider {
    const existing = this.instances.get(provider);
    if (existing) return existing;

    const instance = this.build(provider);
    this.instances.set(provider, instance);
    return instance;
  }

  private build(provider: ProviderName): LLMProvider {
    if (!PROVIDER_KEY_ENV[provider]) throw new Error(`Unknown LLM provider: ${provider}`);
    if (!this.isConfigured(provider)) throw new ProviderNotConfiguredError(provider);
    const key = process.env[PROVIDER_KEY_ENV[provider]]!.trim();

    switch (provider) {
      case 'gemini':
        return new GeminiProvider(key);
      case 'claude':
        return new ClaudeProvider(key);
      case 'openrouter':
        return new OpenAICompatibleProvider('openrouter', key, OPENROUTER_BASE_URL);
      case 'groq':
        return new OpenAICompatibleProvider('groq', key, groqBaseUrl());
      case 'openai':
        return new OpenAICompatibleProvider('openai', key);
    }
  }
}
