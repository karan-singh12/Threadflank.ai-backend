import { UsageInfo } from '../core/providers/provider.types';

/**
 * Rough USD price list used to estimate spend per AiRequestLog row.
 * Token models: USD per 1M tokens. Per-run models (image/video): USD per call.
 * These are estimates for the dashboard, not billing. Override any entry with
 * AI_PRICE_OVERRIDES='{"gemini-2.5-flash":{"input":0.3,"output":2.5},"cuuupid/idm-vton":{"perRun":0.03}}'.
 */
type Price = { input?: number; output?: number; perRun?: number };

const DEFAULT_PRICES: Record<string, Price> = {
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
  'openai/gpt-oss-20b': { input: 0.075, output: 0.3 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'meta-llama/llama-3.1-8b-instruct': { input: 0.02, output: 0.05 },
  'text-embedding-004': { input: 0.02 },
  'gemini-embedding-001': { input: 0.15 },
  // Image engines used by Drape when Replicate isn't configured (per generated image).
  'gemini-2.5-flash-image': { perRun: 0.039 },
  'google/gemini-2.5-flash-image': { perRun: 0.039 },
  'gpt-image-1': { perRun: 0.063 },
  'cuuupid/idm-vton': { perRun: 0.03 },
  'black-forest-labs/flux-schnell': { perRun: 0.003 },
  'black-forest-labs/flux-kontext-pro': { perRun: 0.04 },
  'flux-kontext-apps/multi-image-kontext-pro': { perRun: 0.04 },
  'wan-video/wan-2.2-i2v-fast': { perRun: 0.05 },
};

let prices: Record<string, Price> | null = null;

function priceTable(): Record<string, Price> {
  if (prices) return prices;
  let overrides: Record<string, Price> = {};
  try {
    overrides = process.env.AI_PRICE_OVERRIDES ? JSON.parse(process.env.AI_PRICE_OVERRIDES) : {};
  } catch {
    overrides = {};
  }
  prices = { ...DEFAULT_PRICES, ...overrides };
  return prices;
}

/** Strips a Replicate version hash ("owner/model:abc123") so it matches the table. */
const baseModel = (model: string) => model.split(':')[0];

export function estimateCostUsd(model: string, usage?: UsageInfo, runs = 1): number | null {
  // OpenRouter's free tier (model ids ending in ":free") costs nothing.
  if (model.endsWith(':free')) return 0;
  const price = priceTable()[baseModel(model)];
  if (!price) return null;
  if (price.perRun !== undefined) return round(price.perRun * runs);
  if (!usage) return null;
  const input = (usage.promptTokens ?? 0) * (price.input ?? 0);
  const output = (usage.completionTokens ?? 0) * (price.output ?? 0);
  const total = input + output || (usage.totalTokens ?? 0) * (price.input ?? 0);
  return round(total / 1_000_000);
}

const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
