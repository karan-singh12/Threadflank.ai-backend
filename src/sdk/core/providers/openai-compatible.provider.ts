import { ChatOpenAI } from '@langchain/openai';
import { LLMProvider } from './base.provider';
import { GenerateRequest, GenerateResponse, GenerateChunk } from './provider.types';
import { toBindableTools, normalizeToolCalls, normalizeContent } from './tool-format.util';
import { withRetry } from './retry.util';

/**
 * One adapter for every OpenAI-compatible chat API: OpenAI itself, OpenRouter
 * (a gateway to Llama, Qwen, Gemma, …) and Groq. They differ only in base URL,
 * so each is @langchain/openai's ChatOpenAI pointed at its own endpoint.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  readonly supportsEmbedding = false;

  constructor(
    readonly name: string,
    private readonly apiKey: string,
    private readonly baseURL?: string,
  ) {}

  private buildChatModel(request: GenerateRequest) {
    return new ChatOpenAI({
      apiKey: this.apiKey,
      model: request.model,
      temperature: request.temperature ?? 0.7,
      maxTokens: request.maxTokens,
      configuration: this.baseURL ? { baseURL: this.baseURL } : undefined,
    });
  }

  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    return withRetry(this.name, async () => {
      let model: any = this.buildChatModel(request);
      const boundTools = toBindableTools(request.tools);
      if (boundTools) model = model.bindTools(boundTools);

      const response = await model.invoke(
        request.messages.map((m) => ({ role: m.role, content: m.content })),
      );

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
