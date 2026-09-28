export type ProviderName = 'gemini' | 'claude' | 'openrouter' | 'groq' | 'openai';

export const PROVIDER_NAMES: readonly ProviderName[] = ['gemini', 'claude', 'openrouter', 'groq', 'openai'];

export type TaskType =
  | 'caption-generation'
  | 'agentic-reasoning'
  | 'cheap-bulk-task'
  | 'rag-answer'
  | 'wardrobe-combos';

export interface ProviderModelChoice {
  provider: ProviderName;
  model: string;
}

export interface RouteOverride {
  provider?: ProviderName;
  model?: string;
}
