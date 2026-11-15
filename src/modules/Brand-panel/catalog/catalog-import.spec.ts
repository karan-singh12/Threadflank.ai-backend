import { normalizeImportRow, ImportResolver } from './catalog-import';

const resolver: ImportResolver = {
  category: (v) => {
    const hit = ['Ethnic Wear', 'Streetwear'].find((c) => c.toLowerCase() === v.trim().toLowerCase());
    if (!hit) throw new Error(`Category "${v}" is not one of: Ethnic Wear, Streetwear.`);
    return hit;
  },
  occasions: (vs) => vs.map((v) => v.trim().replace(/^./, (c) => c.toUpperCase())),
};
const ok = { title: 'Zari lehenga', sku: 'LEH-1', price: '84,000', category: 'ethnic wear' };

describe('normalizeImportRow', () => {
  it('accepts a minimal row and fixes the category spelling', () => {
    expect(normalizeImportRow(ok, resolver)).toEqual({ title: 'Zari lehenga', sku: 'LEH-1', price: 84000, category: 'Ethnic Wear' });
  });

  it('reads delimited lists, rupee signs and Live/Draft words', () => {
    const row = normalizeImportRow(
      { ...ok, price: '₹1,500', originalPrice: '2000', occasions: 'shaadi|festive', colors: 'Red, Blue', sizes: 'S|M', stock: '7', images: 'https://a.com/1.jpg|https://a.com/2.jpg', buyUrl: 'https://a.com/p', status: 'Live' },
      resolver,
    );
    expect(row).toMatchObject({ price: 1500, originalPrice: 2000, occasions: ['Shaadi', 'Festive'], colors: ['Red', 'Blue'], sizes: ['S', 'M'], stock: 7, status: 'PUBLISHED' });
    expect(row.images).toHaveLength(2);
  });

  it('drops an original price that is not above the price', () => {
    expect(normalizeImportRow({ ...ok, originalPrice: '100' }, resolver).originalPrice).toBeUndefined();
  });

  it.each([
    [{ ...ok, title: '' }, /Title/],
    [{ ...ok, sku: '' }, /SKU/],
    [{ ...ok, price: 'abc' }, /Price/],
    [{ ...ok, price: '0' }, /above 0/],
    [{ ...ok, category: 'Nonsense' }, /not one of/],
    [{ ...ok, stock: '-3' }, /Stock/],
    [{ ...ok, stock: '2.5' }, /Stock/],
    [{ ...ok, images: 'http://insecure.com/a.jpg' }, /https/],
    [{ ...ok, buyUrl: 'not a url' }, /https/],
    [{ ...ok, status: 'maybe' }, /Live or Draft/],
    [{ ...ok, images: Array.from({ length: 9 }, (_, i) => `https://a.com/${i}.jpg`).join('|') }, /At most 8/],
    [null, /empty/],
  ])('rejects a bad row with a readable reason (%#)', (row, reason) => {
    expect(() => normalizeImportRow(row, resolver)).toThrow(reason);
  });
});
