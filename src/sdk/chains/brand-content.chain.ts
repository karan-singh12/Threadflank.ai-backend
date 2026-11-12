import { Injectable } from '@nestjs/common';
import { ModelRouter } from '../core/router/model-router';
import { RouteOverride } from '../core/router/router.types';
import { brandContentPrompt, BrandContentInput, CONTENT_SPECS } from '../prompts/brand-content.prompt';

/** Pulls the options out of a model reply, tolerating code fences and stray prose around the JSON. */
export function parseVariants(raw: string, max: number): string[] {
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(parsed?.variants)) {
        return parsed.variants
          .filter((v: unknown): v is string => typeof v === 'string')
          .map((v: string) => v.trim())
          .filter(Boolean)
          .slice(0, max);
      }
    } catch {
      /* fall through */
    }
  }
  return [];
}

/** Brand copywriter: prompt in, several editable options out. Routed as a "caption-generation" task. */
@Injectable()
export class BrandContentChain {
  constructor(private readonly router: ModelRouter) {}

  async run(input: BrandContentInput, opts: { override?: RouteOverride; requestedBy?: string } = {}): Promise<string[]> {
    const response = await this.router.execute({
      taskType: 'caption-generation',
      messages: [
        { role: 'system', content: 'You are a senior fashion copywriter for Indian brands. You write truthful, on-brand copy and reply with JSON only.' },
        { role: 'user', content: brandContentPrompt(input) },
      ],
      temperature: 0.9,
      maxTokens: Math.min(4000, Math.ceil((CONTENT_SPECS[input.contentType].maxChars / 3) * input.variants) + 300),
      override: opts.override,
      requestedBy: opts.requestedBy,
    });

    const cap = CONTENT_SPECS[input.contentType].maxChars;
    return parseVariants(response.content, input.variants).map((v) => (v.length > cap ? v.slice(0, cap).replace(/\s+\S*$/, '') : v));
  }
}
