import 'dotenv/config';
import { PrismaClient, ContentBlockStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { ClientFactory } from '../src/sdk/core/client-factory';
import { VectorStoreClient } from '../src/sdk/rag/store/vector-store.client';
import { EmbedPipeline } from '../src/sdk/rag/ingestion/embed-pipeline';

/**
 * Backfills the RAG index (Pinecone, namespace "cms") with every published CMS
 * block. Publishing a block ingests it automatically; run this after first
 * setting PINECONE_API_KEY, or to rebuild the index. Safe to re-run: each
 * block's old chunks are replaced.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const pipeline = new EmbedPipeline(new ClientFactory(), new VectorStoreClient());
  const blocks = await prisma.contentBlock.findMany({ where: { isDeleted: false, status: ContentBlockStatus.PUBLISHED } });

  let chunks = 0;
  for (const block of blocks) {
    const text = typeof block.body === 'string' ? block.body : JSON.stringify(block.body);
    const count = await pipeline.ingest({ sourceType: 'content-block', sourceId: block.id, text, metadata: { key: block.key, type: block.type } }, 'cms');
    console.log(`[seed-rag] ${block.key}: ${count} chunk(s)`);
    chunks += count;
  }
  console.log(`[seed-rag] Ingested ${blocks.length} published block(s), ${chunks} chunk(s) into namespace "cms".`);
}

main()
  .catch((e) => {
    console.error('[seed-rag] Failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
