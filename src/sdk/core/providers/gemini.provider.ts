import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import { LLMProvider } from './base.provider';
import { GenerateRequest, GenerateResponse, GenerateChunk } from './provider.types';
import { toBindableTools, normalizeToolCalls, normalizeContent } from './tool-format.util';
import { withRetry } from './retry.util';

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  readonly supportsEmbedding = true;

  private readonly apiKey: string;
  private readonly embeddingModel: string;

  constructor(apiKey: string, embeddingModel = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001') {
    this.apiKey = apiKey;
    this.embeddingModel = embeddingModel;
  }

  private buildChatModel(request: GenerateRequest) {
    return new ChatGoogleGenerativeAI({
      apiKey: this.apiKey,
      model: request.model,
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: request.maxTokens,
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

  async embed(texts: string[]): Promise<number[][]> {
    return withRetry(this.name, async () => {
      const embeddings = new GoogleGenerativeAIEmbeddings({ apiKey: this.apiKey, model: this.embeddingModel });
      return embeddings.embedDocuments(texts);
    });
  }
}
