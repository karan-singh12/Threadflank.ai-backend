import 'dotenv/config';
import { ClientFactory } from '../src/sdk/core/client-factory';
import { VectorStoreClient } from '../src/sdk/rag/store/vector-store.client';
import { EmbedPipeline } from '../src/sdk/rag/ingestion/embed-pipeline';
import { STYLE_GUIDE_NAMESPACE, styleGuideDocuments } from '../src/sdk/rag/knowledge/style-guide';

/**
 * Indexes the Occasion Planner style guide (src/sdk/rag/knowledge/style-guide.ts)
 * into Pinecone, namespace "style". Re-run after editing the guide. Safe to
 * re-run: each entry's old chunks are replaced.
 */
async function main() {
  const pipeline = new EmbedPipeline(new ClientFactory(), new VectorStoreClient());
  const docs = styleGuideDocuments();

  let chunks = 0;
  for (const doc of docs) {
    const count = await pipeline.ingest(doc, STYLE_GUIDE_NAMESPACE);
    console.log(`[seed-rag-style] ${doc.sourceId}: ${count} chunk(s)`);
    chunks += count;
  }
  console.log(`[seed-rag-style] Ingested ${docs.length} style rule(s), ${chunks} chunk(s) into namespace "${STYLE_GUIDE_NAMESPACE}".`);
}

main().catch((e) => {
  console.error('[seed-rag-style] Failed:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
