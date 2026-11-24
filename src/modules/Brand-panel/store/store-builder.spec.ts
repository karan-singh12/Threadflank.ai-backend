import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { defaultLayout, normaliseLayout, readLayout, slugProblem, toSlug } from './store-layout';
import { StoreBuilderService } from './store-builder.service';
import { StoreLayoutService } from './store-layout.service';
import { BrandStoreService } from '../../User-panel/brand-showcase/brand-store.service';

describe('store layout', () => {
  it('keeps what each section type needs and drops the rest', () => {
    const out = normaliseLayout({
      sections: [
        { id: 'a', type: 'collection', collection: '  Wedding Edit ', occasion: 'Haldi', limit: 12 },
        { id: 'b', type: 'new_arrivals', title: '  Just in  ', hidden: true },
      ],
      pinned: ['p1', 'p1', 'p2'],
    });
    expect(out).toEqual({
      version: 1,
      pinned: ['p1', 'p2'],
      sections: [
        { id: 'a', type: 'collection', collection: 'Wedding Edit', limit: 12 },
        { id: 'b', type: 'new_arrivals', title: 'Just in', hidden: true },
      ],
    });
  });

  it('explains each problem by section number', () => {
    expect(() => normaliseLayout({ sections: [{ id: 'a', type: 'collection' }] })).toThrow('Section 1: pick which collection to show.');
    expect(() => normaliseLayout({ sections: [{ id: 'a', type: 'featured', limit: 2 }] })).toThrow('Section 1: show between 4 and 24 pieces.');
    expect(() => normaliseLayout({ sections: [{ id: 'a', type: 'featured' }, { id: 'a', type: 'bestsellers' }] })).toThrow('Two sections share the id "a".');
    expect(() => normaliseLayout({ sections: [{ id: 'a', type: 'banner' }] })).toThrow('Section 1 has an unknown type.');
    expect(() => normaliseLayout({ sections: [], pinned: Array.from({ length: 9 }, (_, i) => `p${i}`) })).toThrow('You can pin up to 8 pieces.');
    expect(() => normaliseLayout({ sections: [], coverVideo: 'javascript:alert(1)' })).toThrow('needs a full https:// link');
  });

  it('reads an unreadable stored layout as none instead of failing the page', () => {
    expect(readLayout(null)).toBeNull();
    expect(readLayout({ sections: [{ type: 'nope' }] })).toBeNull();
    expect(readLayout(defaultLayout())).toEqual(defaultLayout());
  });

  it('makes URL slugs and refuses the app\'s own paths', () => {
    expect(toSlug('  Raw Mango & Co. ')).toBe('raw-mango-and-co');
    expect(toSlug('Café Ñandú')).toBe('cafe-nandu');
    expect(slugProblem('ab')).toMatch(/at least 3/);
    expect(slugProblem('pricing')).toMatch(/used by ThreadFlank/);
    expect(slugProblem('raw--mango')).toMatch(/single hyphens/);
    expect(slugProblem('raw-mango')).toBeNull();
  });
});

describe('store builder', () => {
  const brandRow = (over: Record<string, unknown> = {}) => ({ id: 'b1', slug: 'raw-mango', previousSlugs: ['rm'], storeDraft: null, storeLayout: null, storePublishedAt: null, ...over });
  const setup = (row = brandRow()) => {
    const prisma: any = {
      brand: { findFirst: jest.fn().mockResolvedValue(row), update: jest.fn().mockResolvedValue({}) },
      brandProduct: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
      brandReel: { findMany: jest.fn().mockResolvedValue([{ id: 'r1' }]) },
      brandVideo: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return { prisma, svc: new StoreBuilderService(prisma, {} as StoreLayoutService) };
  };

  it("keeps only the brand's own pinned pieces and videos in a draft", async () => {
    const { prisma, svc } = setup();
    await svc.saveDraft('b1', { sections: [{ id: 'v', type: 'videos', videoIds: ['r1', 'someone-elses'] }], pinned: ['p1', 'p9'] });
    const saved = prisma.brand.update.mock.calls[0][0].data.storeDraft;
    expect(saved.pinned).toEqual(['p1']);
    expect(saved.sections[0].videoIds).toEqual(['r1']);
    expect(prisma.brandProduct.findMany.mock.calls[0][0].where).toEqual({ brandId: 'b1', id: { in: ['p1', 'p9'] } });
  });

  it('publishes the default layout the first time, and refuses when there is nothing new', async () => {
    const first = setup();
    await first.svc.publish('b1');
    const data = first.prisma.brand.update.mock.calls[0][0].data;
    expect(data.storeLayout).toEqual(defaultLayout());
    expect(data.storeDraft).toBe(Prisma.DbNull);

    const again = setup(brandRow({ storeLayout: defaultLayout() }));
    await expect(again.svc.publish('b1')).rejects.toThrow(BadRequestException);
  });

  it('reports unpublished changes only when the draft differs', async () => {
    const layout = defaultLayout();
    expect((await setup(brandRow({ storeLayout: layout, storeDraft: layout })).svc.get('b1')).hasUnpublishedChanges).toBe(false);
    const changed = { ...layout, pinned: ['p1'] };
    expect((await setup(brandRow({ storeLayout: layout, storeDraft: changed })).svc.get('b1')).hasUnpublishedChanges).toBe(true);
  });

  it('changes the URL and remembers the old one for redirects', async () => {
    const { prisma, svc } = setup();
    prisma.brand.findFirst.mockResolvedValueOnce(brandRow()).mockResolvedValueOnce(null).mockResolvedValue(brandRow({ slug: 'rawmango-studio' }));
    await svc.changeSlug('b1', 'RawMango Studio');
    const data = prisma.brand.update.mock.calls[0][0].data;
    expect(data).toEqual({ slug: 'rawmango-studio', previousSlugs: ['raw-mango', 'rm'] });
  });

  it("won't take another brand's current or old URL", async () => {
    const { prisma, svc } = setup();
    prisma.brand.findFirst.mockResolvedValueOnce(brandRow()).mockResolvedValueOnce({ id: 'b2' });
    await expect(svc.changeSlug('b1', 'kalki')).rejects.toThrow(ConflictException);
    const where = prisma.brand.findFirst.mock.calls[1][0].where;
    expect(where.OR).toEqual([{ slug: 'kalki' }, { previousSlugs: { has: 'kalki' } }]);
  });
});

describe('resolving sections', () => {
  const piece = (id: string) => ({ id, brandId: 'b1', title: id, sku: id, price: 100, originalPrice: null, images: ['x'], category: 'Saree', occasions: [], colors: [], sizes: [], stock: 5, isDrapeReady: true, drapeScore: 0, fitScore: null, drapesCount: 0, clicksCount: 0, buyUrl: '', featured: false, newDrop: false, collection: null, description: null, status: 'PUBLISHED', sharesCount: 0, variants: [], _count: { likes: 0, comments: 0 } });

  it('opens with pinned pieces in the brand order and flags empty sections', async () => {
    const prisma: any = {
      brandProduct: { findMany: jest.fn(async ({ where }: any) => (where.id ? [piece('p2'), piece('p1')] : [])) },
      brandProductLike: { findMany: jest.fn().mockResolvedValue([{ productId: 'p2' }]) },
    };
    const svc = new StoreLayoutService(prisma, { listPublic: jest.fn().mockResolvedValue([]) } as any);
    const out = await svc.resolve('b1', { version: 1, pinned: ['p1', 'p2'], sections: [{ id: 'f', type: 'featured' }] }, { userId: 'u1' });
    expect(out.sections.map((s) => s.id)).toEqual(['pinned', 'f']);
    expect(out.sections[0].products!.map((p) => [p.id, p.likedByMe])).toEqual([
      ['p1', false],
      ['p2', true],
    ]);
    expect(out.sections[1].empty).toBe(true);
  });
});

describe('shopper store', () => {
  it('finds a brand by an old URL and never returns its GST number', async () => {
    const row = { id: 'b1', name: 'Raw Mango', slug: 'raw-mango-studio', logoUrl: null, description: null, category: null, websiteUrl: null, isVerified: false, socialLinks: {}, createdAt: new Date(), gstin: '27AAPFU0939F1ZV', storeLayout: null };
    const prisma: any = {
      brand: { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(row) },
      brandProduct: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    };
    const svc = new BrandStoreService(prisma, {} as any, {} as any);
    const out = await svc.catalog('raw-mango', {} as any);
    expect(prisma.brand.findFirst.mock.calls[1][0].where.previousSlugs).toEqual({ has: 'raw-mango' });
    expect(out.brand.slug).toBe('raw-mango-studio');
    expect(JSON.stringify(out)).not.toMatch(/27AAPFU0939F1ZV|storeLayout/);
  });
});
