import { isPublicHttpsUrl } from './widget-tryon.service';

describe('isPublicHttpsUrl (widget garment photos)', () => {
  it('allows public https images', () => {
    expect(isPublicHttpsUrl('https://cdn.shopify.com/s/files/1/kurta.jpg')).toBe(true);
    expect(isPublicHttpsUrl('https://8.8.8.8/a.png')).toBe(true);
  });

  it('refuses plain http, credentials and non-URLs', () => {
    expect(isPublicHttpsUrl('http://shop.example.com/a.jpg')).toBe(false);
    expect(isPublicHttpsUrl('https://user:pass@shop.example.com/a.jpg')).toBe(false);
    expect(isPublicHttpsUrl('file:///etc/passwd')).toBe(false);
    expect(isPublicHttpsUrl('not a url')).toBe(false);
  });

  it('refuses the server itself and private networks', () => {
    for (const u of ['https://localhost/a', 'https://127.0.0.1/a', 'https://10.0.0.5/a', 'https://172.20.1.1/a', 'https://192.168.1.10/a', 'https://169.254.169.254/latest/meta-data', 'https://[::1]/a', 'https://[fd00::1]/a', 'https://db.internal/a']) {
      expect(isPublicHttpsUrl(u)).toBe(false);
    }
  });
});
