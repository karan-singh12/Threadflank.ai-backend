import { BrandInsightsService, MIN_AUDIENCE, ageBucket, anonymise, cityOf } from './brand-insights.service';

describe('insight privacy rules', () => {
  it('folds buckets of fewer than five shoppers into Other', () => {
    const out = anonymise(
      new Map([
        ['Jaipur', 12],
        ['Pune', 3],
        ['Indore', 1],
        ['Delhi', 6],
      ]),
      22,
    );
    expect(out).toEqual([
      { label: 'Jaipur', share: 55 },
      { label: 'Delhi', share: 27 },
      { label: 'Other', share: 18 },
    ]);
  });

  it('buckets ages and tidies cities', () => {
    expect([ageBucket(null), ageBucket(16), ageBucket(22), ageBucket(30), ageBucket(40), ageBucket(61)]).toEqual(['Not shared', 'Under 18', '18–24', '25–34', '35–44', '45+']);
    expect(cityOf('jaipur, Rajasthan')).toBe('Jaipur');
    expect(cityOf('  ')).toBe('Not shared');
  });

  it(`hides the audience below ${MIN_AUDIENCE} shoppers and never returns who they are`, async () => {
    const few: any = {
      brandEvent: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]) },
      brandFollow: { findMany: jest.fn().mockResolvedValue([{ userId: 'u2' }]) },
    };
    expect(await new BrandInsightsService(few).audience('b1')).toEqual({ enough: false, total: 2, needed: MIN_AUDIENCE });

    const ids = Array.from({ length: 25 }, (_, i) => ({ userId: `u${i}` }));
    const many: any = {
      brandEvent: { findMany: jest.fn().mockResolvedValue(ids) },
      brandFollow: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue(ids.map((_, i) => ({ location: i < 20 ? 'Jaipur' : 'Pune', twinProfile: { age: 28, gender: i % 2 ? 'female' : 'male' } }))) },
    };
    const out = await new BrandInsightsService(many).audience('b1');
    expect(out.enough).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/u1|u2|email|username/);
    const sel = many.user.findMany.mock.calls[0][0].select;
    expect(Object.keys(sel).sort()).toEqual(['location', 'twinProfile']);
  });

  it('shows search terms only once they repeat', async () => {
    const prisma: any = {
      brandEvent: {
        groupBy: jest.fn().mockResolvedValue([
          { query: 'banarasi saree', _count: { _all: 9 } },
          { query: 'a very specific one-off', _count: { _all: 1 } },
        ]),
      },
    };
    expect(await new BrandInsightsService(prisma).searchTerms('b1', 30)).toEqual([{ term: 'banarasi saree', visits: 9 }]);
  });

  it("compares the brand's try-ons per piece with other brands in the same category", async () => {
    const prisma: any = {
      $queryRaw: jest.fn().mockResolvedValue([
        { category: 'Lehenga', mine: true, drapes: 30, pieces: 10 },
        { category: 'Lehenga', mine: false, drapes: 200, pieces: 100 },
      ]),
    };
    expect(await new BrandInsightsService(prisma).benchmark('b1')).toEqual([{ category: 'Lehenga', mine: 3, average: 2, pieces: 10, vsAverage: 50 }]);
  });
});
