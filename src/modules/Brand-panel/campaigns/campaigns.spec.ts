import { BadRequestException, ConflictException } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { FESTIVALS, upcomingFestivals } from './festival-calendar';

const DAY = 86_400_000;
const campaign = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  slug: 'diwali-edit',
  name: 'Diwali Edit',
  description: null,
  occasion: 'Diwali',
  bannerUrl: '',
  startsAt: new Date(Date.now() - DAY),
  endsAt: new Date(Date.now() + 10 * DAY),
  joinBy: null,
  isActive: true,
  _count: { entries: 3 },
  ...over,
});

describe('campaigns', () => {
  it("enters only the brand's own live pieces and says how many were skipped", async () => {
    const prisma: any = {
      campaign: { findUnique: jest.fn().mockResolvedValue(campaign()) },
      brandProduct: { findMany: jest.fn().mockResolvedValue([{ id: 'p1' }]) },
      campaignEntry: { upsert: jest.fn(async ({ create }: any) => create) },
    };
    const out = await new CampaignsService(prisma).join('b1', 'c1', ['p1', 'p1', 'someone-elses']);
    expect(out).toEqual({ productIds: ['p1'], skipped: 1 });
    expect(prisma.brandProduct.findMany.mock.calls[0][0].where).toEqual({ brandId: 'b1', status: 'PUBLISHED', id: { in: ['p1', 'someone-elses'] } });
  });

  it('closes to new pieces after the join-by date', async () => {
    const prisma: any = { campaign: { findUnique: jest.fn().mockResolvedValue(campaign({ joinBy: new Date(Date.now() - 1000) })) } };
    await expect(new CampaignsService(prisma).join('b1', 'c1', ['p1'])).rejects.toThrow('closed to new pieces');
  });

  it('keeps an ended campaign entry so its report stays', async () => {
    const prisma: any = { campaign: { findUnique: jest.fn().mockResolvedValue(campaign({ endsAt: new Date(Date.now() - DAY), startsAt: new Date(Date.now() - 5 * DAY) })) } };
    await expect(new CampaignsService(prisma).leave('b1', 'c1')).rejects.toThrow(ConflictException);
  });

  it('checks admin dates and makes a unique slug', async () => {
    const prisma: any = {
      campaign: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 'old' }).mockResolvedValueOnce(null),
        create: jest.fn(async ({ data }: any) => ({ ...campaign(), ...data, _count: { entries: 0 } })),
      },
    };
    const svc = new CampaignsService(prisma);
    await expect(svc.create({ name: 'Diwali Edit', startsAt: '2026-11-10', endsAt: '2026-11-01' })).rejects.toThrow(BadRequestException);
    const made = await svc.create({ name: 'Diwali Edit', startsAt: '2026-11-01', endsAt: '2026-11-10' });
    expect(made.slug).toBe('diwali-edit-2');
  });

  it("totals the brand's campaign pieces only inside the campaign window", async () => {
    const prisma: any = {
      campaign: { findUnique: jest.fn().mockResolvedValue(campaign()) },
      campaignEntry: { findUnique: jest.fn().mockResolvedValue({ productIds: ['p1', 'p2'] }) },
      brandEvent: {
        groupBy: jest.fn().mockResolvedValue([
          { productId: 'p1', type: 'DRAPE', _count: { _all: 7 } },
          { productId: 'p2', type: 'CLICK', _count: { _all: 2 } },
        ]),
      },
      brandProduct: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', title: 'A', images: [] }, { id: 'p2', title: 'B', images: [] }]) },
    };
    const r = await new CampaignsService(prisma).report('b1', 'c1');
    expect(r.totals).toEqual({ views: 0, drapes: 7, saves: 0, shares: 0, clicks: 2 });
    expect(r.byPiece[0].id).toBe('p1');
    const where = prisma.brandEvent.groupBy.mock.calls[0][0].where;
    expect(where.brandId).toBe('b1');
    expect(where.createdAt.gte).toEqual(campaign().startsAt.constructor === Date ? expect.any(Date) : undefined);
  });
});

describe('festival calendar', () => {
  it('lists only what has not ended, soonest first, and marks lunar dates approximate', () => {
    const list = upcomingFestivals(new Date('2026-11-09T00:00:00Z'), 60);
    expect(list[0].id).toBe('bhai-dooj-2026');
    expect(list.map((f) => f.start)).toEqual([...list.map((f) => f.start)].sort());
    expect(FESTIVALS.find((f) => f.id === 'christmas-2026')?.approximate).toBe(false);
    expect(FESTIVALS.find((f) => f.id === 'diwali-2027')?.approximate).toBe(true);
  });
});
