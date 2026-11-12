import { afterCursor, decodeCursor, encodeCursor, orderFor } from './brand-store.service';

describe('store cursor', () => {
  it('round-trips', () => {
    const c = { id: 'a', c: '2026-01-01T00:00:00.000Z', p: 10, f: true };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
  });
  it('rejects garbage', () => {
    expect(() => decodeCursor('nope!!')).toThrow();
  });
  it('orders and pages consistently', () => {
    expect(orderFor('price_asc')[0]).toEqual({ price: 'asc' });
    expect(JSON.stringify(afterCursor('new', { id: 'x', c: '2026-01-01T00:00:00.000Z' }))).toContain('"id":{"lt":"x"}');
    expect(JSON.stringify(afterCursor('featured', { id: 'x', c: '2026-01-01T00:00:00.000Z', f: true }))).toContain('"featured":false');
  });
});
