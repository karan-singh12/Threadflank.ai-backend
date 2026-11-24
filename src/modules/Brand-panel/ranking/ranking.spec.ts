import { monthKey, monthRange, nextRankGap, previousMonth, rankAll, rankingTips, scoreOf, type Activity } from './ranking-formula';
import { RankingService } from './ranking.service';
import { BrandDashboardService } from '../analytics/brand-dashboard.service';

const zero: Activity = { drapes: 0, saves: 0, shares: 0, clicks: 0, views: 0, launches: 0, livePieces: 10 };

describe('ranking formula', () => {
  it('uses India time for month boundaries', () => {
    // 19:00 UTC on 30 Nov is 00:30 IST on 1 Dec.
    expect(monthKey(new Date('2026-11-30T19:00:00Z'))).toBe('2026-12');
    expect(monthKey(new Date('2026-11-30T18:00:00Z'))).toBe('2026-11');
    const { start, end } = monthRange('2026-12');
    expect(start.toISOString()).toBe('2026-11-30T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    expect(previousMonth('2027-01')).toBe('2026-12');
  });

  it('applies the blueprint weights', () => {
    const b = scoreOf({ ...zero, drapes: 10, saves: 2, shares: 1, clicks: 5, views: 100, launches: 1 });
    // 40 + 6 + 3 + 10 + 10 + 5
    expect(b.raw).toBe(74);
    expect(b.score).toBe(74);
    expect(b.parts.views).toEqual({ count: 100, points: 10 });
  });

  it('scales big catalogs so quantity alone does not win', () => {
    const small = scoreOf({ ...zero, drapes: 100, livePieces: 50 });
    const big = scoreOf({ ...zero, drapes: 100, livePieces: 200 });
    expect(small.catalogFactor).toBe(1);
    expect(big.catalogFactor).toBe(0.5);
    expect(big.score).toBe(small.score / 2);
  });

  it('ranks ties together and leaves out brands with no score', () => {
    const rows = [
      { brandId: 'a', breakdown: scoreOf({ ...zero, drapes: 5 }) },
      { brandId: 'b', breakdown: scoreOf({ ...zero, drapes: 10 }) },
      { brandId: 'c', breakdown: scoreOf({ ...zero, drapes: 5 }) },
      { brandId: 'd', breakdown: scoreOf(zero) },
    ];
    const out = rankAll(rows);
    expect(out.map((s) => [s.brandId, s.rank])).toEqual([
      ['b', 1],
      ['a', 2],
      ['c', 2],
    ]);
    expect(nextRankGap(out, 'a')).toEqual({ rank: 1, pointsNeeded: 20.1 });
    expect(nextRankGap(out, 'b')).toBeNull();
    expect(nextRankGap(out, 'd')).toBeNull();
  });

  it('suggests the changes most likely to help', () => {
    const tips = rankingTips(scoreOf({ ...zero, drapes: 100, clicks: 1, livePieces: 4 }), { upcomingLaunch: false, photosNeedingWork: 2, noBuyLink: 0 });
    expect(tips[0]).toMatch(/Schedule a launch/);
    expect(tips.join(' ')).toMatch(/Add more pieces/);
    expect(tips.join(' ')).toMatch(/Fix 2 photos/);
    expect(tips.join(' ')).toMatch(/rarely click through/);
    expect(rankingTips(scoreOf({ ...zero, launches: 1 }), { upcomingLaunch: true, photosNeedingWork: 0, noBuyLink: 0 }).join(' ')).not.toMatch(/Schedule a launch/);
  });
});

describe('ranking service', () => {
  const prismaWith = (pts: { brandId: string; type: string; pts: number }[]) => {
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue(pts),
      brandProduct: { groupBy: jest.fn().mockResolvedValue([{ brandId: 'a', _count: { _all: 10 } }, { brandId: 'b', _count: { _all: 10 } }]) },
      brandDrop: { groupBy: jest.fn().mockResolvedValue([{ brandId: 'b', _count: { _all: 1 } }]) },
      brand: { findMany: jest.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]) },
      brandRanking: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockReturnValue('del'), createMany: jest.fn().mockReturnValue('create') },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    return prisma;
  };

  it('turns trust-weighted points into standings, skipping brands that are no longer live', async () => {
    const prisma = prismaWith([
      { brandId: 'a', type: 'DRAPE', pts: 3 },
      { brandId: 'a', type: 'STORE_VIEW', pts: 40 },
      { brandId: 'b', type: 'CLICK', pts: 2 },
      { brandId: 'gone', type: 'DRAPE', pts: 999 },
    ]);
    const out = await new RankingService(prisma).compute('2026-11');
    // a: 3*4 + 40*0.1 = 16; b: 2*2 + 1 launch*5 = 9
    expect(out.map((s) => [s.brandId, s.score, s.rank])).toEqual([
      ['a', 16, 1],
      ['b', 9, 2],
    ]);
    const sql = prisma.$queryRaw.mock.calls[0][0];
    const text = sql.strings.join('?');
    expect(text).toMatch(/interval '7 days' THEN 0\.5/);
    expect(text).toMatch(/GROUP BY "brandId", type, "productId", "userId", day/);
  });

  it('archives a finished month in one transaction that tolerates a second writer', async () => {
    const prisma = prismaWith([{ brandId: 'a', type: 'DRAPE', pts: 1 }]);
    await new RankingService(prisma).archive('2026-10');
    expect(prisma.brandRanking.deleteMany).toHaveBeenCalledWith({ where: { month: '2026-10' } });
    // b's launch (5 points) beats a's single try-on (4 points).
    expect(prisma.brandRanking.createMany.mock.calls[0][0]).toMatchObject({
      skipDuplicates: true,
      data: [expect.objectContaining({ month: '2026-10', brandId: 'b', rank: 1, score: 5 }), expect.objectContaining({ month: '2026-10', brandId: 'a', rank: 2, score: 4 })],
    });
  });

  it('reads a past month from the archive instead of recomputing', async () => {
    const prisma = prismaWith([]);
    prisma.brandRanking.findMany.mockResolvedValue([{ brandId: 'a', score: 5, rank: 1, breakdown: {} }]);
    const out = await new RankingService(prisma).standings('2025-01');
    expect(out).toEqual([{ brandId: 'a', score: 5, rank: 1, breakdown: {} }]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('dashboard', () => {
  it('flags pieces that are tried on a lot but rarely clicked, with a likely reason', async () => {
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([
        { productId: 'p1', drapes: 40, clicks: 1 },
        { productId: 'p2', drapes: 20, clicks: 10 },
      ]),
      brandProduct: { findMany: jest.fn().mockResolvedValue([{ id: 'p1', title: 'Gota lehenga', images: ['x'], price: 9000, stock: 0, buyUrl: 'https://a' }]) },
    };
    const out = await new BrandDashboardService(prisma, {} as any).missed('b1');
    expect(out).toEqual([{ id: 'p1', title: 'Gota lehenga', image: 'x', price: 9000, drapes: 40, clicks: 1, clickRate: 2.5, reason: 'Out of stock' }]);
  });

  it('puts a launch without a banner first and caps the list at six', async () => {
    const soon = new Date(Date.now() + 5 * 3_600_000);
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValueOnce([{ productId: 'p9', this_week: 12, last_week: 3 }]).mockResolvedValue([{ productId: 'p1', drapes: 40, clicks: 0 }]),
      brandDrop: { findMany: jest.fn().mockResolvedValue([{ id: 'd1', title: 'Diwali Edit', collectionName: 'Diwali', launchDate: soon, bannerUrl: '' }]) },
      brandProduct: {
        findMany: jest.fn().mockResolvedValueOnce([{ id: 'p3', title: 'Chanderi kurta' }]).mockResolvedValue([{ id: 'p1', title: 'Gota lehenga', images: [], price: 1, stock: 5, buyUrl: '' }]),
        count: jest.fn().mockResolvedValue(3),
        findUnique: jest.fn().mockResolvedValue({ title: 'Banarasi saree' }),
      },
    };
    const ranking: any = { forBrand: jest.fn().mockResolvedValue({ rank: 4, previous: { rank: 9, score: 10 } }) };
    const out = await new BrandDashboardService(prisma, ranking).alerts('b1');
    expect(out[0]).toMatchObject({ tone: 'warn', title: '“Diwali Edit” launches in 5 hours and has no banner' });
    expect(out.find((a) => a.id === 'trend-p9')?.title).toBe('Banarasi saree is trending');
    expect(out.find((a) => a.id === 'rank')).toMatchObject({ tone: 'good', detail: 'Up from #9 last month.' });
    expect(out.length).toBeLessThanOrEqual(6);
  });
});
