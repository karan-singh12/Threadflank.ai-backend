import { Injectable } from '@nestjs/common';
import { ModelRouter } from '../core/router/model-router';
import { captionGenerationPrompt, CaptionPromptInput } from '../prompts/caption-generation.prompt';
import { RouteOverride } from '../core/router/router.types';

/** Simplest possible chain: prompt-in, router.execute, string-out. Demonstrates the
 * router picking a provider for the "caption-generation" task type. */
@Injectable()
export class CaptionGenerationChain {
  constructor(private readonly router: ModelRouter) {}

  async run(input: CaptionPromptInput, opts: { override?: RouteOverride; requestedBy?: string } = {}): Promise<string> {
    const response = await this.router.execute({
      taskType: 'caption-generation',
      messages: [
        { role: 'system', content: 'You are a concise, on-brand fashion social copywriter.' },
        { role: 'user', content: captionGenerationPrompt(input) },
      ],
      temperature: 0.8,
      maxTokens: 120,
      override: opts.override,
      requestedBy: opts.requestedBy,
    });

    return response.content.trim();
  }
}
