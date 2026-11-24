import { AVAILABLE_STOCK, shopifyRow, storeOrigin, wooRow } from './store-sync';
import { fetchPublic } from '../../../common/utils/public-url';

const pick = (t: string | undefined) => (t === 'Kurta' ? 'Kurtas' : 'Ethnic Wear');

describe('store sync mapping', () => {
  it('maps a Shopify product: lowest variant price, sizes and colours, availability, link', () => {
    const row = shopifyRow(
      {
        id: 42,
        title: 'Chanderi kurta',
        handle: 'chanderi-kurta',
        body_html: '<p>Hand <b>woven</b> &amp; light</p>',
        product_type: 'Kurta',
        images: [{ src: '//cdn.shopify.com/a.jpg' }, { src: 'http://insecure/b.jpg' }],
        options: [
          { name: 'Size', values: ['S', 'M'] },
          { name: 'Colour', values: ['Ivory'] },
        ],
        variants: [
          { sku: 'CK-S', price: '2499.00', compare_at_price: '2999.00', available: false },
          { sku: 'CK-M', price: '2299.00', compare_at_price: null, available: true },
        ],
      },
      'https://shop.example.com',
      pick,
      'DRAFT',
    );
    expect(row).toMatchObject({
      externalId: '42',
      sku: 'CK-S',
      price: '2299',
      originalPrice: '2999',
      category: 'Kurtas',
      description: 'Hand woven & light',
      images: 'https://cdn.shopify.com/a.jpg',
      sizes: 'S|M',
      colors: 'Ivory',
      stock: String(AVAILABLE_STOCK),
      buyUrl: 'https://shop.example.com/products/chanderi-kurta',
      status: 'DRAFT',
    });
  });

  it('falls back to the chosen category and a generated SKU, and marks sold-out pieces', () => {
    const row = shopifyRow({ id: 7, title: 'Stole', handle: 'stole', product_type: 'Accessory', variants: [{ price: '500', available: false }] }, 'https://s.com', pick, 'PUBLISHED');
    expect(row).toMatchObject({ sku: 'shopify-7', category: 'Ethnic Wear', stock: '0', status: 'PUBLISHED' });
  });

  it('maps a WooCommerce product with prices in minor units', () => {
    const row = wooRow(
      {
        id: 9,
        name: 'Silk saree',
        sku: '',
        permalink: 'https://woo.example.com/p/silk-saree',
        prices: { price: '450000', regular_price: '500000', currency_minor_unit: 2 },
        images: [{ src: 'https://woo.example.com/s.jpg' }],
        categories: [{ name: 'Sarees' }, { name: 'Kurta' }],
        attributes: [{ name: 'Color', terms: [{ name: 'Red' }] }],
        is_in_stock: true,
      },
      pick,
      'DRAFT',
    );
    expect(row).toMatchObject({ sku: 'woo-9', price: '4500', originalPrice: '5000', category: 'Kurtas', colors: 'Red', stock: String(AVAILABLE_STOCK), buyUrl: 'https://woo.example.com/p/silk-saree' });
  });

  it('turns any store address into its https origin', () => {
    expect(storeOrigin('shop.example.com/collections/all')).toBe('https://shop.example.com');
    expect(storeOrigin('http://brand.myshopify.com')).toBe('https://brand.myshopify.com');
  });
});

describe('fetchPublic', () => {
  it('refuses private addresses before any request is made', async () => {
    await expect(fetchPublic('https://127.0.0.1/products.json')).rejects.toThrow('not a public');
    await expect(fetchPublic('https://169.254.169.254/latest')).rejects.toThrow('not a public');
  });
});
