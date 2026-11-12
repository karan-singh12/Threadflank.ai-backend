import { BadRequestException } from '@nestjs/common';

/**
 * Cursor ("keyset") pagination: the page link holds the last row's sort values, so every page is one
 * indexed seek, no matter how deep. Offset pages get slower the further you go and shift when rows are added.
 */
export const encodeCursor = (c: object) => Buffer.from(JSON.stringify(c)).toString('base64url');

export function decodeCursor<T extends { id: string }>(raw: string): T {
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (c && typeof c.id === 'string') return c as T;
  } catch {
    /* fall through */
  }
  throw new BadRequestException('That page link is not valid. Reload the list.');
}

/** Fetch limit+1 rows to know whether another page exists without a COUNT. */
export function sliceByLimit<T>(rows: T[], limit: number): { page: T[]; more: boolean } {
  const more = rows.length > limit;
  return { page: more ? rows.slice(0, limit) : rows, more };
}
