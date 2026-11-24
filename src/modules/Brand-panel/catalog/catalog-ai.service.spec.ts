import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { CatalogAiService, DESCRIBE_COST, TAG_COST } from './catalog-ai.service';
import { BrandCatalogService } from './brand-catalog.service';
import { VisionUnavailableError } from '../../../shared/vision/vision.service';

jest.mock('../ai-studio/source-image', () => ({
  // A tiny but valid PNG header: 1080x1440.
  loadSourceImage: jest.fn(async () => {
    const b = Buffer.alloc(33);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
    b.write('IHDR', 12, 'ascii');
    b.writeUInt32BE(1080, 16);
    b.writeUInt32BE(1440, 20);
    return { bytes: b, mimeType: 'image/png' };
  }),
  asDataUri: () => 'data:image/png;base64,AAAA',
}));

const taxonomy: any = {
  list: jest.fn(async (kind: string) => (kind === 'CATEGORY' ? [{ name: 'Lehenga' }, { name: 'Saree' }] : [{ name: 'Sangeet' }, { name: 'Haldi' }])),
};

function setup(opts: { credits?: number; vision?: jest.Mock; piece?: Record<string, unknown> } = {}) {
  const spent: number[] = [];
  const prisma: any = {
    brand: {
      findFirst: jest.fn().mockResolvedValue({ socialLinks: { aiCredits: opts.credits ?? 10 } }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Raw Mango' }),
    },
    brandProduct: {
      findFirst: jest.fn().mockResolvedValue(opts.piece ?? { id: 'p1', images: ['https://cdn/p1.jpg'], drapeCheckedAt: null, drapeScore: 0, drapeIssues: [] }),
      findMany: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    // spendBrandCredits runs one UPDATE ... RETURNING; the mock plays the database.
    $queryRaw: jest.fn(async (_s: TemplateStringsArray, ..._v: unknown[]) => {
      const cost = Number(_v[0]);
      spent.push(cost);
      return [{ credits: (opts.credits ?? 10) - cost }];
    }),
  };
  const vision: any = { json: opts.vision ?? jest.fn(), isConfigured: () => true };
  return { svc: new CatalogAiService(prisma, taxonomy, vision), prisma, vision, spent };
}

describe('auto-tagging', () => {
  it('charges once, after the engine answered, and only returns listed values', async () => {
    const vision = jest.fn().mockResolvedValue({ title: 'Gota lehenga', category: 'lehenga', occasions: ['sangeet', 'Prom'], colors: ['mustard'], fabric: 'Georgette', pattern: 'gota', tags: ['festive'] });
    const { svc, spent } = setup({ vision });
    const out = await svc.autoTag('b1', { imageUrl: 'https://cdn/p1.jpg' });
    expect(out).toMatchObject({ category: 'Lehenga', occasions: ['Sangeet'], colors: ['Mustard'], creditsDeducted: TAG_COST, remainingCredits: 10 - TAG_COST });
    expect(spent).toEqual([TAG_COST]);
    expect(vision.mock.calls[0][0].schema.properties.category.enum).toEqual(['Lehenga', 'Saree']);
  });

  it('charges nothing when the engine fails, and says so', async () => {
    const { svc, spent } = setup({ vision: jest.fn().mockRejectedValue(new VisionUnavailableError('429', true)) });
    await expect(svc.autoTag('b1', { imageUrl: 'x' })).rejects.toThrow('out of quota right now. No credits were charged');
    expect(spent).toEqual([]);
  });

  it('refuses before calling the engine when the brand cannot pay', async () => {
    const vision = jest.fn();
    const { svc } = setup({ credits: 0, vision });
    await expect(svc.autoTag('b1', { imageUrl: 'x' })).rejects.toThrow(BadRequestException);
    expect(vision).not.toHaveBeenCalled();
  });

  it('does not charge for an answer it cannot use', async () => {
    const { svc, spent } = setup({ vision: jest.fn().mockResolvedValue({ category: 'Spaceship', colors: [], fabric: 'unknown' }) });
    await expect(svc.autoTag('b1', { imageUrl: 'x' })).rejects.toThrow(ServiceUnavailableException);
    expect(spent).toEqual([]);
  });
});

describe('listing copy', () => {
  it('needs something to describe', async () => {
    const { svc } = setup();
    await expect(svc.describe('b1', { tone: 'elegant', language: 'english' })).rejects.toThrow('Add a photo, a title or a category first');
  });

  it('writes Hinglish on request and charges the describe price', async () => {
    const vision = jest.fn().mockResolvedValue({ title: 'Red Banarasi saree', description: 'Shaadi season ke liye perfect, gold zari border ke saath ek classic red saree.', seoKeywords: ['red saree'] });
    const { svc, spent } = setup({ vision });
    const out = await svc.describe('b1', { title: 'Red saree', tone: 'festive', language: 'hinglish' });
    expect(out.title).toBe('Red Banarasi saree');
    expect(spent).toEqual([DESCRIBE_COST]);
    expect(vision.mock.calls[0][0].prompt).toMatch(/Hinglish/);
  });
});

describe('drape-ready photo check', () => {
  const front = { mainSubject: 'single_garment', view: 'front', presentation: 'on_model', background: 'plain', garmentFullyVisible: true, wellLit: true, textOrWatermark: false };

  it('saves the score and issues on the piece', async () => {
    const { svc, prisma } = setup({ vision: jest.fn().mockResolvedValue({ ...front, background: 'busy' }) });
    const out = await svc.drapeCheck('b1', 'p1');
    expect(out).toMatchObject({ status: 'good', score: 85, checked: true });
    const data = prisma.brandProduct.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ drapeScore: 85, drapeIssues: [expect.stringMatching(/busy/)] });
    expect(data.drapeCheckedAt).toBeInstanceOf(Date);
    expect(prisma.brandProduct.findFirst.mock.calls[0][0].where).toEqual({ id: 'p1', brandId: 'b1' });
  });

  it('keeps an earlier full result when the engine is down', async () => {
    const earlier = { id: 'p1', images: ['https://cdn/p1.jpg'], drapeCheckedAt: new Date('2026-11-01'), drapeScore: 90, drapeIssues: [] };
    const { svc, prisma } = setup({ piece: earlier, vision: jest.fn().mockRejectedValue(new Error('503')) });
    const out = await svc.drapeCheck('b1', 'p1');
    expect(out).toMatchObject({ status: 'good', score: 90, checked: false });
    expect(prisma.brandProduct.update).not.toHaveBeenCalled();
  });

  it('asks for a photo when there is none', async () => {
    const { svc } = setup({ piece: { id: 'p1', images: [], drapeCheckedAt: null, drapeScore: 0, drapeIssues: [] } });
    expect(await svc.drapeCheck('b1', 'p1')).toMatchObject({ status: 'missing', issues: ['Add a photo of the piece.'] });
  });
});

describe('catalog writes', () => {
  const passthrough: any = { requireCategory: async (v: string) => v, requireOccasions: async (v: string[]) => v, invalidatePublic: () => undefined };
  const base = { id: 'p1', brandId: 'b1', title: 'T', sku: 'RM-1', price: 1000, originalPrice: null, images: ['https://cdn/a.jpg'], category: 'Saree', occasions: [], colors: [], sizes: [], stock: 0, isDrapeReady: true, drapeScore: 0, fitScore: null, drapesCount: 0, clicksCount: 0, buyUrl: 'https://shop.example.com/a', featured: false, newDrop: false, collection: null, description: null, status: 'PUBLISHED', publishedAt: new Date(), sharesCount: 0, tags: [], seoKeywords: [], drapeIssues: [], drapeCheckedAt: null, variants: [], _count: { likes: 0, comments: 0 } };

  it('replaces the variant table and keeps the roll-up on the piece', async () => {
    const tx: any = {
      brandVariant: { deleteMany: jest.fn(), createMany: jest.fn() },
      brandProduct: { update: jest.fn(async ({ data }: any) => ({ ...base, ...data })) },
    };
    const prisma: any = {
      brandProduct: { findFirst: jest.fn().mockResolvedValue(base), findUnique: jest.fn().mockResolvedValue({ publishedAt: new Date() }) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const svc = new BrandCatalogService(prisma, passthrough);
    await svc.update('b1', 'p1', { variants: [{ size: 'S', color: 'Red', stock: 2 }, { size: 'M', color: 'Red', stock: 5 }] } as any);
    expect(tx.brandVariant.deleteMany).toHaveBeenCalledWith({ where: { productId: 'p1' } });
    expect(tx.brandVariant.createMany.mock.calls[0][0].data).toHaveLength(2);
    expect(tx.brandProduct.update.mock.calls[0][0].data).toMatchObject({ stock: 7, sizes: ['S', 'M'], colors: ['Red'] });
  });

  it("works out 'can be tried on' itself instead of trusting the client", async () => {
    const tx: any = { brandVariant: {}, brandProduct: { update: jest.fn(async ({ data }: any) => ({ ...base, ...data })) } };
    const prisma: any = { brandProduct: { findFirst: jest.fn().mockResolvedValue(base) }, $transaction: jest.fn(async (fn: any) => fn(tx)) };
    await new BrandCatalogService(prisma, passthrough).update('b1', 'p1', { images: [], isDrapeReady: true, drapeScore: 99 } as any);
    const data = tx.brandProduct.update.mock.calls[0][0].data;
    expect(data.isDrapeReady).toBe(false);
    expect(data).not.toHaveProperty('drapeScore');
  });

  it('sends shoppers to the buy link with UTM tags', async () => {
    const prisma: any = { brandProduct: { findFirst: jest.fn().mockResolvedValue({ ...base, collection: 'Festive 26', brand: { slug: 'raw-mango' } }), update: jest.fn() } };
    const out = await new BrandCatalogService(prisma, passthrough).recordPublicClick('p1');
    const url = new URL(out!.buyUrl);
    expect(url.origin + url.pathname).toBe('https://shop.example.com/a');
    expect(url.searchParams.get('utm_campaign')).toBe('festive-26');
    expect(url.searchParams.get('utm_content')).toBe('RM-1');
  });

  it('shows shoppers "only N left" but keeps healthy stock counts private', async () => {
    const low = { ...base, stock: 2, variants: [{ id: 'v1', size: 'S', color: '', colorHex: null, sku: null, price: null, stock: 2 }] };
    const prisma: any = { brandProduct: { findMany: jest.fn().mockResolvedValueOnce([low]).mockResolvedValueOnce([{ ...base, stock: 40 }]) } };
    const svc = new BrandCatalogService(prisma, passthrough);
    const [a] = await svc.listPublic('b1');
    expect(a).toMatchObject({ stockState: 'low', stockLeft: 2, variants: [{ size: 'S', available: true, low: true }] });
    expect(JSON.stringify(a.variants)).not.toMatch(/"stock"/);
    const [b] = await svc.listPublic('b1');
    expect(b.stockState).toBe('in');
    expect(b).not.toHaveProperty('stockLeft');
  });
});
