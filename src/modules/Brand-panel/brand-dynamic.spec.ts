import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BrandBiddingService, leaderOf } from './bidding/brand-bidding.service';
import { BrandCatalogService } from './catalog/brand-catalog.service';
import { BrandDropsService } from './drops/brand-drops.service';
import { publicSocialLinks, toPublicBrand } from '../Admin-panel/brands/public-brand';
import { candidatesFromBrand } from './catalog/post-catalog';

/** The admin lists are not under test here: accept whatever category and occasions come in. */
const passthrough: any = { requireCategory: async (v: string) => v, requireOccasions: async (v: string[]) => v, invalidatePublic: () => undefined };

const at = (n: number) => new Date(2026, 0, 1, 0, 0, n);

describe('public brand data never leaks private account fields', () => {
  const social = {
    instagram: 'https://instagram.com/acme',
    banner: 'https://x/b.jpg',
    workEmail: 'owner@acme.com',
    aiCredits: 90,
    rankScore: 4,
    verification: { decision: 'approve', reason: 'ok', reviewedBy: 'admin-1' },
    isOnlineOnly: true,
    flagshipAddress: '',
  };
  it('keeps only allow-listed keys', () => {
    expect(publicSocialLinks(social)).toEqual({ instagram: 'https://instagram.com/acme', banner: 'https://x/b.jpg', isOnlineOnly: true });
  });
  it('is safe for odd input', () => {
    expect(publicSocialLinks(null)).toEqual({});
    expect(publicSocialLinks('x')).toEqual({});
    expect(publicSocialLinks([1])).toEqual({});
  });
  it('applies to a whole brand row', () => {
    const out = toPublicBrand({ id: 'b', name: 'Acme', socialLinks: social });
    expect(JSON.stringify(out)).not.toMatch(/owner@acme|aiCredits|reviewedBy|rankScore/);
    expect(out.name).toBe('Acme');
  });
});

describe('catalog is scoped to the brand and reports duplicate SKUs', () => {
  const row = { id: 'p1', brandId: 'b1', title: 'T', sku: 'S', price: 10, originalPrice: null, images: [], category: 'c', occasions: [], colors: [], sizes: [], stock: 0, isDrapeReady: false, drapeScore: 0, fitScore: null, drapesCount: 0, clicksCount: 0, buyUrl: 'https://a', featured: false, newDrop: true, description: null, status: 'PUBLISHED', scheduledAt: null, publishedAt: null, sharesCount: 0, sourcePostId: null, _count: { likes: 0, comments: 0 } };
  it('reads only the signed-in brand rows', async () => {
    const prisma: any = { brandProduct: { findMany: jest.fn().mockResolvedValue([row]), findFirst: jest.fn().mockResolvedValue(null), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    const svc = new BrandCatalogService(prisma, passthrough);
    await svc.findAll('b1');
    expect(prisma.brandProduct.findMany.mock.calls[0][0].where).toEqual({ brandId: 'b1' });
    await expect(svc.findOne('b1', 'someone-elses')).rejects.toThrow(NotFoundException);
    expect(prisma.brandProduct.findFirst.mock.calls[0][0].where).toEqual({ id: 'someone-elses', brandId: 'b1' });
    await expect(svc.remove('b1', 'someone-elses')).rejects.toThrow(NotFoundException);
    expect(prisma.brandProduct.deleteMany.mock.calls[0][0].where).toEqual({ id: 'someone-elses', brandId: 'b1' });
  });
  it('turns a unique-constraint error into a clear conflict', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    const prisma: any = { brand: { findUnique: jest.fn().mockResolvedValue(null) }, brandDrop: { count: jest.fn().mockResolvedValue(0) }, brandAccount: { count: jest.fn().mockResolvedValue(1) }, creatorCollab: { count: jest.fn().mockResolvedValue(0) }, brandProduct: { count: jest.fn().mockResolvedValue(0), create: jest.fn().mockRejectedValue(err) } };
    await expect(new BrandCatalogService(prisma, passthrough).create('b1', { title: 'T', sku: 'S', price: 1, images: [], category: 'c', buyUrl: 'https://a' } as any)).rejects.toThrow(ConflictException);
  });
  it('public view hides internal fields and counts only approved brands for clicks', async () => {
    const prisma: any = { brandProduct: { findMany: jest.fn().mockResolvedValue([{ ...row, stock: 3 }]), findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } };
    const svc = new BrandCatalogService(prisma, passthrough);
    const [p] = await svc.listPublic('b1');
    expect(p).not.toHaveProperty('sku');
    expect(p).not.toHaveProperty('clicksCount');
    expect(p.inStock).toBe(true);
    expect(await svc.recordPublicClick('p1')).toBeNull();
    expect(prisma.brandProduct.findFirst.mock.calls[0][0].where.brand).toEqual({ isDeleted: false, status: 'ACTIVE' });
    expect(prisma.brandProduct.update).not.toHaveBeenCalled();
  });
});

describe('drop waitlist', () => {
  const future = new Date(Date.now() + 3 * 86_400_000);
  const build = (drop: any) => {
    const prisma: any = {
      brandDrop: { findFirst: jest.fn().mockResolvedValue(drop) },
      dropWaitlistEntry: { upsert: jest.fn(), count: jest.fn().mockResolvedValue(1), deleteMany: jest.fn() },
    };
    return { svc: new BrandDropsService(prisma), prisma };
  };
  it('joining is idempotent and only for upcoming drops of approved brands', async () => {
    const { svc, prisma } = build({ id: 'd1', launchDate: future });
    expect(await svc.joinWaitlist('d1', 'u1')).toEqual({ joined: true, waitlistCount: 1 });
    expect(prisma.dropWaitlistEntry.upsert.mock.calls[0][0].update).toEqual({});
    expect(prisma.brandDrop.findFirst.mock.calls[0][0].where.brand).toEqual({ isDeleted: false, status: 'ACTIVE' });
  });
  it('refuses a drop that already launched or does not exist', async () => {
    await expect(build({ id: 'd1', launchDate: new Date(Date.now() - 1000) }).svc.joinWaitlist('d1', 'u1')).rejects.toThrow(BadRequestException);
    await expect(build(null).svc.joinWaitlist('d1', 'u1')).rejects.toThrow(NotFoundException);
  });
});

describe('runway bidding', () => {
  it('leaderOf: highest wins, earlier bid wins a tie', () => {
    expect(leaderOf([])).toBeUndefined();
    expect(leaderOf([{ brandId: 'a', amount: 5000, createdAt: at(1) }, { brandId: 'b', amount: 7000, createdAt: at(2) }])?.brandId).toBe('b');
    expect(leaderOf([{ brandId: 'a', amount: 5000, createdAt: at(1) }, { brandId: 'b', amount: 5000, createdAt: at(2) }])?.brandId).toBe('a');
  });

  const endsAt = new Date(Date.now() + 5 * 3_600_000);
  const slot = (bids: any[] = []) => ({ id: 's1', cycleId: 'c1', rank: 1, title: 'Hero', category: 'All', minBid: 1000, impressionsEstimate: '', projectedViews: 0, projectedDrapes: 0, winnerBrandId: null, winningAmount: null, paid: false, bids });
  const build = (opts: { status?: string; bids?: any[]; cycle?: boolean } = {}) => {
    const cycle = { id: 'c1', label: 'Nov 2026', endsAt, status: 'OPEN', slots: [slot(opts.bids)] };
    const prisma: any = {
      brand: { findUnique: jest.fn().mockResolvedValue({ status: opts.status ?? 'ACTIVE', isDeleted: false }) },
      bidCycle: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(opts.cycle === false ? null : cycle) },
      bid: { create: jest.fn() },
      bidSlot: { findUniqueOrThrow: jest.fn().mockResolvedValue(slot([...(opts.bids ?? []), { brandId: 'me', amount: 8000, createdAt: at(9) }])) },
    };
    return { svc: new BrandBiddingService(prisma), prisma };
  };

  it('shows open / winning / outbid from the bids themselves', async () => {
    const { svc } = build({ bids: [{ brandId: 'rival', amount: 9000, createdAt: at(1) }, { brandId: 'me', amount: 4000, createdAt: at(2) }] });
    const [s] = await svc.findAll('me');
    expect(s).toMatchObject({ status: 'outbid', currentHighestBid: 9000, minimumBid: 9001, yourCurrentBid: 4000 });
    expect((await build({ bids: [] }).svc.findAll('me'))[0]).toMatchObject({ status: 'open', currentHighestBid: 0, minimumBid: 1000 });
  });

  it('returns nothing when no auction is open', async () => {
    expect(await build({ cycle: false }).svc.findAll('me')).toEqual([]);
    await expect(build({ cycle: false }).svc.placeBid('me', 1, { bidAmount: 5000 })).rejects.toThrow(BadRequestException);
  });

  it('only approved brands may bid', async () => {
    for (const status of ['PENDING', 'INACTIVE']) {
      const { svc, prisma } = build({ status });
      await expect(svc.placeBid('me', 1, { bidAmount: 5000 })).rejects.toThrow(ForbiddenException);
      expect(prisma.bid.create).not.toHaveBeenCalled();
    }
  });

  it('enforces the starting price and beating the top bid', async () => {
    const { svc, prisma } = build({ bids: [{ brandId: 'rival', amount: 6000, createdAt: at(1) }] });
    await expect(svc.placeBid('me', 1, { bidAmount: 6000 })).rejects.toThrow(BadRequestException);
    await expect(svc.placeBid('me', 1, { bidAmount: 500 })).rejects.toThrow(BadRequestException);
    expect(prisma.bid.create).not.toHaveBeenCalled();
    const ok = await svc.placeBid('me', 1, { bidAmount: 8000 });
    expect(prisma.bid.create).toHaveBeenCalledWith({ data: { slotId: 's1', brandId: 'me', amount: 8000 } });
    expect(ok.slot.status).toBe('winning');
  });

  it('rejects an unknown slot', async () => {
    await expect(build().svc.placeBid('me', 7, { bidAmount: 5000 })).rejects.toThrow(NotFoundException);
  });

  it('closing a cycle records winners once', async () => {
    const tx: any = {
      bidCycle: { updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) },
      bidSlot: { findMany: jest.fn().mockResolvedValue([slot([{ brandId: 'a', amount: 3000, createdAt: at(1) }, { brandId: 'b', amount: 4000, createdAt: at(2) }]), { ...slot([]), id: 's2', rank: 2 }]), update: jest.fn() },
    };
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    const svc = new BrandBiddingService(prisma);
    expect(await svc.closeCycle('c1')).toBe(true);
    expect(tx.bidSlot.update).toHaveBeenCalledTimes(1); // the empty slot has no winner
    expect(tx.bidSlot.update.mock.calls[0][0]).toEqual({ where: { id: 's1' }, data: { winnerBrandId: 'b', winningAmount: 4000 } });
    expect(await svc.closeCycle('c1')).toBe(false); // second closer does nothing
    expect(tx.bidSlot.update).toHaveBeenCalledTimes(1);
  });

  it('admin cannot open a second auction or one in the past', async () => {
    const { svc, prisma } = build();
    const slots = [{ title: 'Hero', category: 'All' }];
    await expect(svc.createCycle({ label: 'x', endsAt: '2020-01-01T00:00:00Z', slots }, 'a1')).rejects.toThrow(BadRequestException);
    await expect(svc.createCycle({ label: 'x', endsAt: new Date(Date.now() + 86_400_000).toISOString(), slots }, 'a1')).rejects.toThrow(/already open/);
    expect(prisma.bidCycle.findFirst).toHaveBeenCalled();
  });
});

describe('catalog item = post (migration rules)', () => {
  const post = (over: object = {}) => ({ id: 'cmpost12345678', title: null, caption: 'Grey hoodie under a light bomber. Easy weekend layer.', images: ['/a.jpg', '/b.jpg'], category: 'Casual', taggedProducts: null, variants: [], status: 'PUBLISHED' as const, sharesCount: 4, publishedAt: new Date('2026-10-01'), createdAt: new Date('2026-09-30'), ...over });
  const brand = (posts: any[]) => ({ id: 'b1', name: 'Adidas', category: 'Sportswear', websiteUrl: 'https://www.adidas.co.in/', posts });

  it('a plain post becomes one piece named from its caption, with the caption, status, shares and dates carried over', () => {
    const { candidates } = candidatesFromBrand(brand([post()]));
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ title: 'Grey hoodie under a light bomber', description: 'Grey hoodie under a light bomber. Easy weekend layer.', status: 'PUBLISHED', sharesCount: 4, price: 0, firstOfPost: true, postId: 'cmpost12345678', buyUrl: 'https://www.adidas.co.in/' });
    expect(candidates[0].images).toEqual(['/a.jpg', '/b.jpg']);
    expect(candidates[0].publishedAt).toEqual(new Date('2026-10-01'));
  });
  it('drafts stay drafts (they are not made public by the migration)', () => {
    expect(candidatesFromBrand(brand([post({ status: 'DRAFT', publishedAt: null })])).candidates[0].status).toBe('DRAFT');
  });
  it('a post with several tagged products: only the first piece inherits the post (likes and comments land once)', () => {
    const tagged = [{ name: 'Jacket', price: '₹4,999', thumbnail: '/j.jpg' }, { name: 'Cap', price: '₹999', thumbnail: '/c.jpg' }];
    const { candidates } = candidatesFromBrand(brand([post({ taggedProducts: tagged })]));
    expect(candidates.map((c) => [c.title, c.price, c.firstOfPost])).toEqual([['Jacket', 4999, true], ['Cap', 999, false]]);
  });
  it('a post with no caption and no photo is skipped with a reason, never invented', () => {
    const r = candidatesFromBrand(brand([post({ caption: '', images: [] }), post({ id: 'cmpost2', images: [] })]));
    expect(r.candidates).toHaveLength(0);
    expect(r.skipped.map((s) => s.why)).toEqual(['no caption to name it', 'no photo']);
  });
});

describe('only published pieces reach shoppers', () => {
  const draft = { id: 'p1', brandId: 'b1', title: 'T', sku: 'S', price: 1, originalPrice: null, images: ['/x.jpg'], category: 'c', occasions: [], colors: [], sizes: [], stock: 1, isDrapeReady: false, drapeScore: 0, fitScore: null, drapesCount: 0, clicksCount: 0, buyUrl: 'https://a', featured: false, newDrop: false, description: 'Cap', status: 'DRAFT', scheduledAt: null, publishedAt: null, sharesCount: 0, sourcePostId: null, _count: { likes: 2, comments: 0 } };
  it('the public list asks for PUBLISHED only, and the Buy redirect refuses drafts', async () => {
    const prisma: any = { brandProduct: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } };
    const svc = new BrandCatalogService(prisma, passthrough);
    await svc.listPublic('b1');
    expect(prisma.brandProduct.findMany.mock.calls[0][0].where).toEqual({ brandId: 'b1', status: 'PUBLISHED' });
    expect(await svc.recordPublicClick('p1')).toBeNull();
    expect(prisma.brandProduct.findFirst.mock.calls[0][0].where.status).toBe('PUBLISHED');
  });
  it('the brand still sees its own drafts, with likes, shares and caption', async () => {
    const prisma: any = { brandProduct: { findMany: jest.fn().mockResolvedValue([draft]) } };
    const [p] = await new BrandCatalogService(prisma, passthrough).findAll('b1');
    expect(p).toMatchObject({ status: 'DRAFT', description: 'Cap', likesCount: 2, commentsCount: 0, sharesCount: 0 });
  });
});
