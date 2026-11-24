import { CreatorsService, collabCode, isCollabCode, ATTRIBUTION_DAYS } from './creators.service';

const DAY = 86_400_000;
const pro = { plan: 'PRO', planUntil: new Date(Date.now() + 10 * DAY) };

const prismaFor = (over: any = {}) => ({
  stylistProfile: { findFirst: jest.fn().mockResolvedValue({ userId: 'c1' }), findUnique: jest.fn() },
  creatorCollab: {
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation(({ data }) => ({ id: 'k1', ...data })),
    ...over.creatorCollab,
  },
  brand: { findUnique: jest.fn().mockResolvedValue({ ...pro, name: 'Raw Mango' }) },
  brandProduct: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
  brandDrop: { count: jest.fn().mockResolvedValue(0), findFirst: jest.fn().mockResolvedValue({ id: 'd1' }) },
  brandAccount: { count: jest.fn().mockResolvedValue(1) },
  ...over.rest,
});

describe('collab codes', () => {
  it('are 8 characters without look-alikes', () => {
    for (let i = 0; i < 50; i++) expect(isCollabCode(collabCode())).toBe(true);
    expect(isCollabCode('ABCD0OIL')).toBe(false);
  });
});

describe('requesting a collab', () => {
  it('keeps only published pieces of the brand and tells the creator', async () => {
    const prisma: any = prismaFor();
    const createMany = jest.fn().mockResolvedValue(undefined);
    const row = await new CreatorsService(prisma, { createMany } as any).request('b1', { creatorId: 'c1', kind: 'DRAPE_LOOK', brief: 'Style our new kurta set for Diwali', productIds: ['p1', 'x'] });
    expect(row.productIds).toEqual(['p1']);
    expect(createMany.mock.calls[0][0]).toEqual(['c1']);
  });

  it('needs a launch for a launch post, and refuses a second open collab', async () => {
    await expect(new CreatorsService(prismaFor() as any).request('b1', { creatorId: 'c1', kind: 'LAUNCH_PROMO', brief: 'Post about our drop please' })).rejects.toThrow('launch');
    const busy: any = prismaFor({ creatorCollab: { findFirst: jest.fn().mockResolvedValue({ id: 'old' }) } });
    await expect(new CreatorsService(busy).request('b1', { creatorId: 'c1', kind: 'UNBOXING', brief: 'Unbox our festive box' })).rejects.toThrow('already have an open collab');
  });

  it('is a Pro feature', async () => {
    const prisma: any = prismaFor({ rest: { brand: { findUnique: jest.fn().mockResolvedValue({ plan: 'FREE', planUntil: null, name: 'x' }) } } });
    await expect(new CreatorsService(prisma).request('b1', { creatorId: 'c1', kind: 'UNBOXING', brief: 'Unbox our festive box' })).rejects.toThrow(/Free plan allows 0 open creator collabs/);
  });
});

describe('creator side', () => {
  it('cannot mark done without a link or a look', async () => {
    const prisma: any = { creatorCollab: { findFirst: jest.fn().mockResolvedValue({ id: 'k1', status: 'ACCEPTED' }) }, look: { findMany: jest.fn().mockResolvedValue([]) } };
    const svc = new CreatorsService(prisma);
    await expect(svc.deliver('c1', 'k1', {})).rejects.toThrow('link to your post');
    await expect(svc.deliver('c1', 'k1', { url: 'javascript:alert(1)' })).rejects.toThrow('https://');
  });

  it('only answers a pending request once', async () => {
    const prisma: any = { creatorCollab: { findFirst: jest.fn().mockResolvedValue({ id: 'k1', status: 'DECLINED' }) } };
    await expect(new CreatorsService(prisma).respond('c1', 'k1', true)).rejects.toThrow('already answered');
  });
});

describe('tracking link', () => {
  it('sends a launch collab to the launch page and counts the visit', async () => {
    const prisma: any = {
      creatorCollab: { findUnique: jest.fn().mockResolvedValue({ id: 'k1', status: 'ACCEPTED', dropId: 'd1', brand: { slug: 'raw-mango', status: 'ACTIVE', isDeleted: false } }) },
      creatorVisit: { create: jest.fn() },
    };
    const r = await new CreatorsService(prisma).resolve('abcdefgh', 'u1');
    expect(r.path).toBe('/launch/d1?ref=ABCDEFGH');
    expect(prisma.creatorVisit.create).toHaveBeenCalledWith({ data: { collabId: 'k1', userId: 'u1' } });
  });

  it('does not work for a pending collab', async () => {
    const prisma: any = { creatorCollab: { findUnique: jest.fn().mockResolvedValue({ id: 'k1', status: 'PENDING', brand: { slug: 's', status: 'ACTIVE', isDeleted: false } }) } };
    await expect(new CreatorsService(prisma).resolve('ABCDEFGH')).rejects.toThrow('not found');
  });

  it('credits try-ons and follows only inside each visitor window', async () => {
    const t0 = new Date('2026-11-01T10:00:00Z');
    const at = (days: number) => new Date(t0.getTime() + days * DAY);
    const prisma: any = {
      creatorVisit: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1', createdAt: t0 }, { userId: null, createdAt: t0 }, { userId: 'u1', createdAt: at(3) }]) },
      brandEvent: {
        findMany: jest.fn().mockResolvedValue([{ userId: 'u1', createdAt: at(1) }, { userId: 'u1', createdAt: at(ATTRIBUTION_DAYS + 1) }]),
        count: jest.fn().mockResolvedValue(4),
      },
      brandFollow: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1', createdAt: at(2) }]) },
      shareEvent: { aggregate: jest.fn().mockResolvedValue({ _sum: { openCount: 9 } }) },
    };
    const s = await new CreatorsService(prisma).stats({ id: 'k1', brandId: 'b1', code: 'ABCDEFGH', lookIds: ['l1'] });
    expect(s).toEqual({ visits: 3, visitors: 1, drapes: 1, follows: 1, clicks: 4, lookViews: 9 });
  });
});
