import { Injectable } from '@nestjs/common';
import { ClientFactory } from '../../core/client-factory';
import { ROUTER_CONFIG } from '../../core/router/router-config';
import { VectorStoreClient, VectorMatch } from '../store/vector-store.client';

@Injectable()
export class Retriever {
  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly vectorStore: VectorStoreClient,
  ) {}

  async retrieve(query: string, topK = 5, namespace = 'default'): Promise<VectorMatch[]> {
    const embeddingProvider = this.clientFactory.get(ROUTER_CONFIG.embeddingProvider);
    if (!embeddingProvider.embed) {
      throw new Error(`Configured embedding provider "${ROUTER_CONFIG.embeddingProvider}" does not support embed()`);
    }
    const [queryVector] = await embeddingProvider.embed([query]);
    return this.vectorStore.query(queryVector, topK, namespace);
  }
}
