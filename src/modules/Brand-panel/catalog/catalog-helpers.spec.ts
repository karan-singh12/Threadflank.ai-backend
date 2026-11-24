import { BadRequestException } from '@nestjs/common';
import { normaliseSizeChart, normaliseVariants, rollUp, stockState } from './catalog-variants';
import { withUtm } from './catalog-utm';
import { cleanDescribeAnswer, cleanTagAnswer, imageDimensions, localPhotoIssues, photoStatus, scoreDrape, type DrapeVision } from './catalog-ai';
import { parseJsonAnswer, toGeminiSchema } from '../../../shared/vision/vision.service';

describe('variants', () => {
  it('cleans rows, keeps the brand order and rolls stock up', () => {
    const v = normaliseVariants([
      { size: ' M ', color: 'Emerald', stock: 3, colorHex: '#1f7a4d' },
      { size: 'L', color: 'Emerald', stock: 0, price: 1299.999 },
      { size: 'M', color: 'Ruby', stock: 5 },
    ]);
    expect(v.map((r) => [r.size, r.color, r.sortOrder])).toEqual([
      ['M', 'Emerald', 0],
      ['L', 'Emerald', 1],
      ['M', 'Ruby', 2],
    ]);
    expect(v[0].colorHex).toBe('#1F7A4D');
    expect(v[1].price).toBe(1300);
    expect(rollUp(v)).toEqual({ stock: 8, sizes: ['M', 'L'], colors: ['Emerald', 'Ruby'] });
  });

  it('names the row of a duplicate, ignoring case', () => {
    expect(() => normaliseVariants([{ size: 'M', color: 'Red', stock: 1 }, { size: 'm', color: 'red', stock: 2 }])).toThrow('Row 2 repeats m / red from row 1.');
  });

  it('rejects rows with nothing to sell and impossible stock', () => {
    expect(() => normaliseVariants([{ stock: 1 }])).toThrow('Row 1 needs a size, a colour, or both.');
    expect(() => normaliseVariants([{ size: 'S', stock: -1 }])).toThrow(BadRequestException);
    expect(() => normaliseVariants([{ size: 'S', stock: 1.5 }])).toThrow(/whole number/);
    expect(() => normaliseVariants([{ size: 'S', stock: 1, colorHex: 'red' }])).toThrow(/#A1B2C3/);
  });

  it('labels stock the way shoppers see it', () => {
    expect([stockState(0), stockState(-2), stockState(1), stockState(3), stockState(4)]).toEqual(['out', 'out', 'low', 'low', 'in']);
  });
});

describe('size chart', () => {
  const ok = { unit: 'in', columns: ['Size', 'Bust', 'Waist'], rows: [['S', '34', '28'], ['M', '36', '']] };

  it('accepts a chart with blank measurements and clears with null', () => {
    expect(normaliseSizeChart(ok)).toEqual(ok);
    expect(normaliseSizeChart(null)).toBeNull();
  });

  it('explains what is wrong', () => {
    expect(() => normaliseSizeChart({ ...ok, unit: 'mm' })).toThrow('Pick inches or centimetres');
    expect(() => normaliseSizeChart({ ...ok, rows: [['S', '34']] })).toThrow('Row 1 of the size chart should have 3 cells.');
    expect(() => normaliseSizeChart({ ...ok, rows: [['', '34', '28']] })).toThrow('needs a size');
    expect(() => normaliseSizeChart({ ...ok, rows: [['S', '1', '2'], ['s', '3', '4']] })).toThrow('Size s is in the chart twice.');
    expect(() => normaliseSizeChart({ ...ok, columns: ['Size'] })).toThrow('at least one measurement');
  });
});

describe('UTM tags on buy links', () => {
  const ctx = { brandSlug: 'raw-mango', productId: 'p1', sku: 'RM-101', collection: 'Wedding Edit 2026' };

  it('tags the link by collection and SKU, keeping the brand\'s own query and anchor', () => {
    const out = new URL(withUtm('https://shop.example.com/p/saree?variant=12#reviews', ctx));
    expect(out.searchParams.get('variant')).toBe('12');
    expect(out.searchParams.get('utm_source')).toBe('threadflank');
    expect(out.searchParams.get('utm_medium')).toBe('referral');
    expect(out.searchParams.get('utm_campaign')).toBe('wedding-edit-2026');
    expect(out.searchParams.get('utm_content')).toBe('RM-101');
    expect(out.hash).toBe('#reviews');
  });

  it('falls back to the brand slug and the piece id', () => {
    const out = new URL(withUtm('https://shop.example.com/x', { brandSlug: 'raw-mango', productId: 'p9' }));
    expect(out.searchParams.get('utm_campaign')).toBe('raw-mango');
    expect(out.searchParams.get('utm_content')).toBe('p9');
  });

  it("never overwrites a brand's own tracking, and leaves odd links alone", () => {
    const own = 'https://shop.example.com/x?utm_source=insta&utm_campaign=diwali';
    expect(withUtm(own, ctx)).toBe(own);
    expect(withUtm('not a link', ctx)).toBe('not a link');
    expect(withUtm('mailto:hi@example.com', ctx)).toBe('mailto:hi@example.com');
  });
});

describe('reading image size from the file header', () => {
  const png = (w: number, h: number) => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.writeUInt32BE(13, 8);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  const jpeg = (w: number, h: number) => {
    // SOI, an APP0 segment to skip, then SOF0 with height before width.
    const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
    const sof = Buffer.alloc(19);
    sof[0] = 0xff;
    sof[1] = 0xc0;
    sof.writeUInt16BE(17, 2);
    sof[4] = 8;
    sof.writeUInt16BE(h, 5);
    sof.writeUInt16BE(w, 7);
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof, Buffer.alloc(8)]);
  };
  const gif = (w: number, h: number) => {
    const b = Buffer.alloc(24);
    b.write('GIF89a', 0, 'ascii');
    b.writeUInt16LE(w, 6);
    b.writeUInt16LE(h, 8);
    return b;
  };

  it('reads PNG, JPEG and GIF', () => {
    expect(imageDimensions(png(900, 1200))).toEqual({ width: 900, height: 1200 });
    expect(imageDimensions(jpeg(1080, 1440))).toEqual({ width: 1080, height: 1440 });
    expect(imageDimensions(gif(320, 240))).toEqual({ width: 320, height: 240 });
  });

  it('returns null for anything else', () => {
    expect(imageDimensions(Buffer.from('hello world, not an image at all'))).toBeNull();
    expect(imageDimensions(Buffer.alloc(4))).toBeNull();
  });

  it('flags small and landscape photos', () => {
    expect(localPhotoIssues({ width: 1080, height: 1440 })).toEqual([]);
    expect(localPhotoIssues({ width: 300, height: 400 })[0]).toMatchObject({ blocking: true });
    expect(localPhotoIssues({ width: 600, height: 800 })[0]).toMatchObject({ blocking: false });
    expect(localPhotoIssues({ width: 1600, height: 900 }).some((i) => /landscape/.test(i.message))).toBe(true);
  });
});

describe('drape-ready score', () => {
  const good: DrapeVision = { mainSubject: 'single_garment', view: 'front', presentation: 'mannequin', background: 'studio', garmentFullyVisible: true, wellLit: true, textOrWatermark: false };

  it('passes a clean front photo', () => {
    expect(scoreDrape(good, [])).toEqual({ score: 100, ready: true, issues: [] });
  });

  it('a blocking problem fails the photo even when the rest is fine', () => {
    const r = scoreDrape({ ...good, view: 'back' }, []);
    expect(r.ready).toBe(false);
    expect(r.score).toBeLessThan(70);
    expect(r.issues).toEqual(['Use a front view. Try-on dresses the front of the person.']);
  });

  it('small warnings add up but do not block on their own', () => {
    const r = scoreDrape({ ...good, background: 'busy', textOrWatermark: true }, []);
    expect(r).toMatchObject({ score: 75, ready: true });
    expect(r.issues).toHaveLength(2);
  });

  it('is never ready without the visual check', () => {
    expect(scoreDrape(null, [])).toEqual({ score: 0, ready: false, issues: [] });
  });

  it('labels the photo for the brand panel', () => {
    expect(photoStatus({ images: [], drapeCheckedAt: null, drapeScore: 0 })).toBe('missing');
    expect(photoStatus({ images: ['a'], drapeCheckedAt: null, drapeScore: 0 })).toBe('unchecked');
    expect(photoStatus({ images: ['a'], drapeCheckedAt: new Date(), drapeScore: 85 })).toBe('good');
    expect(photoStatus({ images: ['a'], drapeCheckedAt: new Date(), drapeScore: 69 })).toBe('needs_work');
  });
});

describe('cleaning AI answers', () => {
  const lists = { categories: ['Lehenga', 'Saree', 'Kurta Set'], occasions: ['Haldi', 'Mehendi', 'Sangeet', 'Diwali'] };

  it('keeps only the admin list values, in their spelling', () => {
    const out = cleanTagAnswer(
      { title: 'Mustard gota lehenga', category: 'lehenga', occasions: ['mehendi', 'Beach Party', 'HALDI', 'mehendi'], colors: ['mustard', 'Gold', 'gold', 'unknown'], fabric: 'unknown', pattern: 'gota patti', tags: ['#Gota', 'festive', 'Festive'] },
      lists,
    );
    expect(out).toEqual({ title: 'Mustard gota lehenga', category: 'Lehenga', occasions: ['Mehendi', 'Haldi'], colors: ['Mustard', 'Gold'], fabric: null, pattern: 'Gota Patti', tags: ['gota', 'festive'] });
  });

  it('drops a category that is not on the list rather than guessing', () => {
    expect(cleanTagAnswer({ category: 'Ball Gown' }, lists).category).toBeNull();
  });

  it('rejects a listing too thin to use and tidies keywords', () => {
    expect(cleanDescribeAnswer({ title: 'Saree', description: 'Nice.' })).toBeNull();
    expect(cleanDescribeAnswer({ title: 'Banarasi silk saree', description: 'A deep red Banarasi silk saree with a gold zari border, made for weddings.', seoKeywords: ['Red Saree', 'red saree', 'banarasi'] })).toEqual({
      title: 'Banarasi silk saree',
      description: 'A deep red Banarasi silk saree with a gold zari border, made for weddings.',
      seoKeywords: ['red saree', 'banarasi'],
    });
  });

  it('reads JSON wrapped in a fence or a sentence', () => {
    expect(parseJsonAnswer<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonAnswer<{ a: number }>('Here you go: {"a":2} hope it helps')).toEqual({ a: 2 });
    expect(() => parseJsonAnswer('no json here')).toThrow();
  });

  it("converts a schema to Gemini's upper-case types, all the way down", () => {
    expect(toGeminiSchema({ type: 'object', properties: { tags: { type: 'array', items: { type: 'string', enum: ['a'] } } }, required: ['tags'] })).toEqual({
      type: 'OBJECT',
      properties: { tags: { type: 'ARRAY', items: { type: 'STRING', enum: ['a'] } } },
      required: ['tags'],
    });
  });
});
