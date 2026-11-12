import { afterFeedCursor } from './catalog-feed.service';
import { decodeCursor, encodeCursor, sliceByLimit } from '../../../common/pagination/cursor';

describe('feed cursor', () => {
  it('continues after a dated piece, then falls through to undated ones', () => {
    const w = JSON.stringify(afterFeedCursor({ id: 'x', p: '2026-01-01T00:00:00.000Z' }));
    expect(w).toContain('"id":{"lt":"x"}');
    expect(w).toContain('"publishedAt":null');
  });
  it('stays inside the undated rows once it is in them', () => {
    expect(afterFeedCursor({ id: 'x', p: null })).toEqual({ publishedAt: null, id: { lt: 'x' } });
  });
  it('round-trips and rejects garbage', () => {
    expect(decodeCursor(encodeCursor({ id: 'a', p: null }))).toEqual({ id: 'a', p: null });
    expect(() => decodeCursor('%%%')).toThrow();
  });
  it('slices the extra row off', () => {
    expect(sliceByLimit([1, 2, 3], 2)).toEqual({ page: [1, 2], more: true });
    expect(sliceByLimit([1, 2], 2)).toEqual({ page: [1, 2], more: false });
  });
});
