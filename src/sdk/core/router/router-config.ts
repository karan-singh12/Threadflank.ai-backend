import { PROVIDER_NAMES, ProviderModelChoice, ProviderName, TaskType } from './router.types';

const isProvider = (value: string | undefined): value is ProviderName =>
  Boolean(value) && PROVIDER_NAMES.includes(value as ProviderName);

/** Default model per provider; each is overridable with its env var. */
export function modelForProvider(provider: ProviderName): string {
  switch (provider) {
    case 'gemini':
      return process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    case 'claude':
      return process.env.CLAUDE_MODEL || 'claude-opus-5';
    case 'openrouter':
      return process.env.OPENROUTER_BULK_MODEL || 'meta-llama/llama-3.1-8b-instruct';
    case 'groq':
      return process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    case 'openai':
      return process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  }
}

/** A task's provider comes from its env var (e.g. AGENT_TASK_PROVIDER=groq); its model follows the provider. */
function route(envVar: string, fallback: ProviderName): ProviderModelChoice {
  const value = process.env[envVar]?.trim();
  const provider = isProvider(value) ? value : fallback;
  return { provider, model: modelForProvider(provider) };
}

/** LLM_FALLBACK_CHAIN="gemini,groq,claude" — unknown names are ignored. */
function fallbackChain(): ProviderName[] {
  const fromEnv = (process.env.LLM_FALLBACK_CHAIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(isProvider);
  return fromEnv.length ? [...new Set(fromEnv)] : ['gemini', 'groq', 'claude', 'openrouter', 'openai'];
}

/**
 * Static routing rules. Not hardcoded in business logic — chains/agents/RAG
 * ask the ModelRouter for "caption-generation" etc. and this table decides
 * who actually serves it. Per-task overrides are configurable via env vars
 * so ops can retarget a task to a different provider/model without a code
 * change. Providers without an API key are skipped at request time, so a
 * task routed to Claude runs on the next configured provider until
 * ANTHROPIC_API_KEY is set.
 */
export const ROUTER_CONFIG: {
  defaultProvider: ProviderName;
  taskRouting: Record<TaskType, ProviderModelChoice>;
  fallbackChain: ProviderName[];
  embeddingProvider: ProviderName;
} = {
  defaultProvider: isProvider(process.env.DEFAULT_LLM_PROVIDER) ? process.env.DEFAULT_LLM_PROVIDER : 'gemini',

  taskRouting: {
    'caption-generation': route('CAPTION_TASK_PROVIDER', 'gemini'),
    'agentic-reasoning': route('AGENT_TASK_PROVIDER', 'claude'),
    'cheap-bulk-task': route('BULK_TASK_PROVIDER', 'groq'),
    'wardrobe-combos': route('COMBOS_TASK_PROVIDER', 'gemini'),
    'rag-answer': route('RAG_TASK_PROVIDER', 'gemini'),
  },

  // Order to try when the chosen provider fails or has no API key.
  fallbackChain: fallbackChain(),

  // Only Gemini implements embed() today; kept configurable for when others add one.
  embeddingProvider: 'gemini',
};
