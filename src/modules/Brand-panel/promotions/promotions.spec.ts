import { PromotionsService, offerLabel, MAX_LIVE_OFFERS } from './promotions.service';

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const prismaWith = (over: any = {}) => ({
  brandProduct: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
  brandOffer: {
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn().mockImplementation(({ data }) => ({ id: 'o1', isActive: true, copies: 0, ...data })),
    ...over,
  },
});

describe('offer labels', () => {
  it('reads as a percentage, rupees, or a flash sale', () => {
    expect(offerLabel({ kind: 'COUPON', percentOff: 20, amountOff: null })).toBe('20% off');
    expect(offerLabel({ kind: 'COUPON', percentOff: null, amountOff: 1500 })).toBe('₹1,500 off');
    expect(offerLabel({ kind: 'FLASH_SALE', percentOff: null, amountOff: null })).toBe('Flash sale');
  });
});

describe('creating offers', () => {
  it('upper-cases the code and keeps only the brand’s own pieces', async () => {
    const prisma: any = prismaWith();
    const o = await new PromotionsService(prisma).create('b1', { kind: 'COUPON', title: 'Diwali', code: ' diwali 20 ', percentOff: 20, endsAt: inDays(5), productIds: ['p1', 'other'] });
    expect(o.code).toBe('DIWALI20');
    expect(o.productIds).toEqual(['p1']);
    expect(o.status).toBe('live');
  });

  it('rejects a code without a discount, both discounts, and backwards dates', async () => {
    const svc = new PromotionsService(prismaWith() as any);
    await expect(svc.create('b1', { kind: 'COUPON', title: 'x', code: 'ABC', endsAt: inDays(2) })).rejects.toThrow('how much');
    await expect(svc.create('b1', { kind: 'COUPON', title: 'x', code: 'ABC', percentOff: 10, amountOff: 100, endsAt: inDays(2) })).rejects.toThrow('not both');
    await expect(svc.create('b1', { kind: 'FLASH_SALE', title: 'x', startsAt: inDays(3), endsAt: inDays(2) })).rejects.toThrow('end after');
    await expect(svc.create('b1', { kind: 'FLASH_SALE', title: 'x', endsAt: inDays(100) })).rejects.toThrow('90 days');
  });

  it('caps how many offers run at once', async () => {
    const svc = new PromotionsService(prismaWith({ count: jest.fn().mockResolvedValue(MAX_LIVE_OFFERS) }) as any);
    await expect(svc.create('b1', { kind: 'FLASH_SALE', title: 'Sale', endsAt: inDays(1) })).rejects.toThrow('at a time');
  });

  it('lets a flash sale run without a code', async () => {
    const prisma: any = prismaWith();
    const o = await new PromotionsService(prisma).create('b1', { kind: 'FLASH_SALE', title: 'Midnight sale', code: 'IGNORED', endsAt: inDays(1) });
    expect(o.code).toBeNull();
    expect(o.label).toBe('Flash sale');
  });
});

describe('shopper side', () => {
  it('only counts copies on active offers', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    await new PromotionsService({ brandOffer: { updateMany } } as any).copied('o1');
    expect(updateMany.mock.calls[0][0]).toEqual({ where: { id: 'o1', isActive: true }, data: { copies: { increment: 1 } } });
  });
});
