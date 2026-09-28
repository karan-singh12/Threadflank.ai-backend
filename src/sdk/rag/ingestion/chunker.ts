/** Naive fixed-size character chunker with overlap — sufficient for short CMS/brand text
 * blocks; swap for a token-aware splitter if longer documents are ingested later. */
export function chunkText(text: string, chunkSize = 1000, overlap = 150): string[] {
  const clean = text.trim();
  if (clean.length <= chunkSize) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    chunks.push(clean.slice(start, end));
    if (end === clean.length) break;
    start = end - overlap;
  }
  return chunks;
}
