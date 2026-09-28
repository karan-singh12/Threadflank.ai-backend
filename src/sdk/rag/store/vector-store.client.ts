import { Injectable } from '@nestjs/common';
import { Pinecone } from '@pinecone-database/pinecone';

export interface VectorRecord {
  id: string;
  values: number[];
  metadata?: Record<string, unknown>;
}

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

/**
 * Thin port over the vector DB so the rest of the RAG pipeline never imports
 * `@pinecone-database/pinecone` directly — swapping to Qdrant/another store
 * later only means rewriting this one file.
 */
@Injectable()
export class VectorStoreClient {
  private client: Pinecone | null = null;

  private getClient(): Pinecone {
    if (!this.client) {
      const apiKey = process.env.PINECONE_API_KEY;
      if (!apiKey) throw new Error('PINECONE_API_KEY is not configured');
      this.client = new Pinecone({ apiKey });
    }
    return this.client;
  }

  private getIndex() {
    const indexName = process.env.PINECONE_INDEX || 'threadflank-rag';
    return this.getClient().index(indexName);
  }

  async upsert(records: VectorRecord[], namespace = 'default'): Promise<void> {
    if (records.length === 0) return;
    const index = this.getIndex().namespace(namespace);
    await index.upsert(records.map((r) => ({ id: r.id, values: r.values, metadata: r.metadata as any })));
  }

  async query(vector: number[], topK = 5, namespace = 'default'): Promise<VectorMatch[]> {
    const index = this.getIndex().namespace(namespace);
    const result = await index.query({ vector, topK, includeMetadata: true });
    return (result.matches ?? []).map((m) => ({
      id: m.id,
      score: m.score ?? 0,
      metadata: m.metadata as Record<string, unknown> | undefined,
    }));
  }

  async deleteByIds(ids: string[], namespace = 'default'): Promise<void> {
    if (ids.length === 0) return;
    const index = this.getIndex().namespace(namespace);
    await index.deleteMany(ids);
  }

  /** Deletes every vector whose id starts with `prefix` (e.g. all chunks of one document). */
  async deleteByPrefix(prefix: string, namespace = 'default'): Promise<number> {
    const index = this.getIndex().namespace(namespace);
    let deleted = 0;
    let paginationToken: string | undefined;
    do {
      const page = await index.listPaginated({ prefix, paginationToken });
      const ids = (page.vectors ?? []).map((v) => v.id).filter((id): id is string => Boolean(id));
      if (ids.length) {
        await index.deleteMany(ids);
        deleted += ids.length;
      }
      paginationToken = page.pagination?.next;
    } while (paginationToken);
    return deleted;
  }
}
