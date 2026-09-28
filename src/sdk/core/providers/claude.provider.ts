import { ChatAnthropic } from '@langchain/anthropic';
import { LLMProvider } from './base.provider';
import { GenerateRequest, GenerateResponse, GenerateChunk } from './provider.types';
import { toBindableTools, normalizeToolCalls, normalizeContent } from './tool-format.util';
import { withRetry } from './retry.util';

/**
 * Current Claude models (Opus 5, Sonnet 5, Fable, Opus 4.7/4.8) reject
 * temperature/top_p/top_k with a 400 and pick their own (adaptive) thinking
 * when `thinking` is omitted. @langchain/anthropic 0.3 always sends all four,
 * so for these models they are blanked out via invocationKwargs — undefined
 * keys are dropped when the request is serialised.
 */
const NO_SAMPLING_MODELS = /^claude-(opus-5|opus-4-[78]|sonnet-5|fable|mythos)/;

export class ClaudeProvider implements LLMProvider {
  readonly name = 'claude';
  readonly supportsEmbedding = false;

  constructor(private readonly apiKey: string) {}

  private buildChatModel(request: GenerateRequest) {
    const base = {
      apiKey: this.apiKey,
      model: request.model,
      // Adaptive thinking spends output tokens too, so leave generous headroom.
      maxTokens: request.maxTokens ?? 16000,
    };
    if (NO_SAMPLING_MODELS.test(request.model)) {
      return new ChatAnthropic({
        ...base,
        invocationKwargs: { temperature: undefined, top_k: undefined, top_p: undefined, thinking: undefined },
      });
    }
    return new ChatAnthropic({ ...base, temperature: request.temperature ?? 0.7 });
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    return withRetry(this.name, async () => {
      let model: any = this.buildChatModel(request);
      const boundTools = toBindableTools(request.tools);
      if (boundTools) model = model.bindTools(boundTools);

      const response = await model.invoke(
        request.messages.map((m) => ({ role: m.role, content: m.content })),
      );

      // A declined request comes back as HTTP 200 with no usable content. Failing here
      // lets the ModelRouter hand the task to the next provider in the chain.
      if (response.response_metadata?.stop_reason === 'refusal') {
        throw new Error('Claude declined the request (stop_reason: refusal)');
      }

      return {
        content: normalizeContent(response.content),
        toolCalls: normalizeToolCalls(response.tool_calls),
        usage: {
          promptTokens: response.usage_metadata?.input_tokens,
          completionTokens: response.usage_metadata?.output_tokens,
          totalTokens: response.usage_metadata?.total_tokens,
        },
        provider: this.name,
        model: request.model,
      };
    });
  }

  async *stream(request: GenerateRequest): AsyncIterable<GenerateChunk> {
    const model = this.buildChatModel(request);
    const stream = await model.stream(
      request.messages.map((m) => ({ role: m.role, content: m.content })),
    );
    for await (const chunk of stream) {
      yield { contentDelta: normalizeContent(chunk.content), done: false };
    }
    yield { contentDelta: '', done: true };
  }
}
