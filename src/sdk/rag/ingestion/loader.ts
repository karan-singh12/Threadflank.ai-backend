/** Generic ingestable document — callers (e.g. the CMS module, on publish) build one of
 * these from their own domain data; this file stays free of any Prisma model imports so
 * the RAG pipeline doesn't depend on which feature module is feeding it. */
export interface RagDocument {
  sourceType: string; // e.g. "content-block", "brand"
  sourceId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export function vectorIdFor(doc: RagDocument, chunkIndex: number): string {
  return `${vectorPrefixFor(doc.sourceType, doc.sourceId)}${chunkIndex}`;
}

/** Shared id prefix of every chunk of one document. */
export function vectorPrefixFor(sourceType: string, sourceId: string): string {
  return `${sourceType}:${sourceId}:`;
}
