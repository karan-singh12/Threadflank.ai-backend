import { Injectable } from '@nestjs/common';
import { Retriever } from './retriever/retriever';
import { ModelRouter } from '../core/router/model-router';

export interface RagQueryResult {
  answer: string;
  sources: { sourceType: string; sourceId: string; score: number }[];
}

/** RAG pipeline example: retrieve top-k chunks from the vector store, then ask the
 * router (task type "rag-answer") to synthesize a grounded answer from them. */
@Injectable()
export class RagQueryService {
  constructor(
    private readonly retriever: Retriever,
    private readonly router: ModelRouter,
  ) {}

  // "cms" is the namespace published CMS content is ingested into (see CmsService.publish).
  async query(question: string, namespace = 'cms', topK = 5, requestedBy?: string): Promise<RagQueryResult> {
    const matches = await this.retriever.retrieve(question, topK, namespace);

    const context = matches
      .map((m, i) => `[${i + 1}] ${m.metadata?.text ?? ''}`)
      .join('\n\n');

    const response = await this.router.execute({
      taskType: 'rag-answer',
      messages: [
        {
          role: 'system',
          content: 'Answer using ONLY the provided context. If the context does not contain the answer, say so plainly. Cite sources as [1], [2] etc.',
        },
        { role: 'user', content: `Context:\n${context || '(no matching context found)'}\n\nQuestion: ${question}` },
      ],
      temperature: 0.2,
      requestedBy,
    });

    return {
      answer: response.content,
      sources: matches.map((m) => ({
        sourceType: String(m.metadata?.sourceType ?? 'unknown'),
        sourceId: String(m.metadata?.sourceId ?? m.id),
        score: m.score,
      })),
    };
  }
}
