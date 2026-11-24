import { NotFoundException } from '@nestjs/common';
import { LaunchService } from './launch.service';

const HOUR = 3_600_000;
const drop = (launchInMs: number, extra: Record<string, unknown> = {}) => ({
  id: 'd1',
  brandId: 'b1',
  title: 'Diwali Edit',
  collectionName: 'Diwali 26',
  description: null,
  launchDate: new Date(Date.now() + launchInMs),
  bannerUrl: '',
  teaserUrl: 'https://cdn/teaser.mp4',
  _count: { waitlist: 40 },
  brand: { id: 'b1', name: 'Raw Mango', slug: 'raw-mango', logoUrl: null, socialLinks: { themeAccent: '#aa3355' } },
  ...extra,
});

describe('launch report', () => {
  it('waits for the launch before reporting', async () => {
    const prisma: any = { brandDrop: { findFirst: jest.fn().mockResolvedValue(drop(5 * HOUR)) }, brandProduct: { count: jest.fn().mockResolvedValue(6) } };
    expect(await new LaunchService(prisma).report('b1', 'd1')).toMatchObject({ launched: false, waitlist: 40, livePieces: 6 });
  });

  it('reports the first day and week, and the waitlist that came back to try it on', async () => {
    const prisma: any = {
      brandDrop: { findFirst: jest.fn().mockResolvedValue(drop(-2 * 24 * HOUR)) },
      brandProduct: { count: jest.fn().mockResolvedValue(6) },
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ type: 'DRAPE', n: 50 }, { type: 'CLICK', n: 2 }])
        .mockResolvedValueOnce([{ type: 'DRAPE', n: 80 }, { type: 'CLICK', n: 4 }, { type: 'PRODUCT_VIEW', n: 300 }])
        .mockResolvedValueOnce([{ n: 10 }]),
    };
    const r = await new LaunchService(prisma).report('b1', 'd1');
    expect(r).toMatchObject({ launched: true, first24h: { drapes: 50, clicks: 2 }, first7d: { drapes: 80, clicks: 4, views: 300 }, waitlistTriedOn: 10, waitlistConversion: 25, clickRate: 5, stillCounting: true });
    expect(prisma.brandDrop.findFirst.mock.calls[0][0].where).toEqual({ id: 'd1', brandId: 'b1' });
  });

  it("is only for the brand's own drops", async () => {
    const prisma: any = { brandDrop: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(new LaunchService(prisma).report('b2', 'd1')).rejects.toThrow(NotFoundException);
  });
});

describe('launch page', () => {
  it('keeps the collection a surprise until launch', async () => {
    const prisma: any = { brandDrop: { findFirst: jest.fn().mockResolvedValue(drop(HOUR)) }, dropWaitlistEntry: { count: jest.fn().mockResolvedValue(1) }, brandProduct: { findMany: jest.fn() } };
    const p = await new LaunchService(prisma).page('d1', 'u1');
    expect(p.drop).toMatchObject({ launched: false, joined: true, teaserUrl: 'https://cdn/teaser.mp4' });
    expect(p.pieces).toEqual([]);
    expect(prisma.brandProduct.findMany).not.toHaveBeenCalled();
    expect(p.brand.themeAccent).toBe('#aa3355');
  });

  it('splits latest launches into live (newest first) and upcoming (soonest first)', async () => {
    const rows = [drop(-HOUR, { id: 'a' }), drop(-5 * HOUR, { id: 'b' }), drop(9 * HOUR, { id: 'c' }), drop(2 * HOUR, { id: 'd' })];
    const prisma: any = { brandDrop: { findMany: jest.fn().mockResolvedValue(rows) } };
    const out = (await new LaunchService(prisma).latest()) as { live: { id: string }[]; upcoming: { id: string }[] };
    expect(out.live.map((d) => d.id)).toEqual(['a', 'b']);
    expect(out.upcoming.map((d) => d.id)).toEqual(['d', 'c']);
  });
});
