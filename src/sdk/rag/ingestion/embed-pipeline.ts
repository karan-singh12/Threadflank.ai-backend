import { Injectable } from '@nestjs/common';
import { ClientFactory } from '../../core/client-factory';
import { ROUTER_CONFIG } from '../../core/router/router-config';
import { VectorStoreClient } from '../store/vector-store.client';
import { chunkText } from './chunker';
import { RagDocument, vectorIdFor, vectorPrefixFor } from './loader';

/** chunk -> embed (via the configured embedding provider) -> upsert to the vector store. */
@Injectable()
export class EmbedPipeline {
  constructor(
    private readonly clientFactory: ClientFactory,
    private readonly vectorStore: VectorStoreClient,
  ) {}

  async ingest(doc: RagDocument, namespace = 'default'): Promise<number> {
    const chunks = chunkText(doc.text);
    if (chunks.length === 0) return 0;

    const embeddingProvider = this.clientFactory.get(ROUTER_CONFIG.embeddingProvider);
    if (!embeddingProvider.embed) {
      throw new Error(`Configured embedding provider "${ROUTER_CONFIG.embeddingProvider}" does not support embed()`);
    }

    const vectors = await embeddingProvider.embed(chunks);

    // A shorter new version would otherwise leave the old version's trailing chunks behind.
    await this.remove(doc.sourceType, doc.sourceId, namespace);
    await this.vectorStore.upsert(
      chunks.map((chunk, i) => ({
        id: vectorIdFor(doc, i),
        values: vectors[i],
        metadata: { ...doc.metadata, sourceType: doc.sourceType, sourceId: doc.sourceId, text: chunk },
      })),
      namespace,
    );

    return chunks.length;
  }

  /** Removes a document's chunks, e.g. when its CMS block is unpublished or deleted. */
  remove(sourceType: string, sourceId: string, namespace = 'default'): Promise<number> {
    return this.vectorStore.deleteByPrefix(vectorPrefixFor(sourceType, sourceId), namespace);
  }
}
