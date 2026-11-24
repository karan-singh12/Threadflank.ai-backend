import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TtlCache } from '../../../common/cache/ttl-cache';

const DAY = 86_400_000;
/** Audience buckets smaller than this are folded into "Other", so no small group can be singled out. */
export const MIN_BUCKET = 5;
/** Below this many engaged shoppers the audience section isn't shown at all. */
export const MIN_AUDIENCE = 20;
/** A wardrobe gap or search term needs this many occurrences to be shown. */
const MIN_COUNT = 3;

const growth = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const titleCase = (v: string) => v.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/** Folds buckets under MIN_BUCKET into "Other" and returns shares in percent. */
export function anonymise(counts: Map<string, number>, total: number) {
  const out: { label: string; share: number }[] = [];
  let other = 0;
  for (const [label, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    if (n < MIN_BUCKET) other += n;
    else out.push({ label, share: Math.round((n / total) * 100) });
  }
  if (other > 0) out.push({ label: 'Other', share: Math.round((other / total) * 100) });
  return out;
}

export function ageBucket(age: number | null): string {
  if (!age || age < 13) return 'Not shared';
  if (age < 18) return 'Under 18';
  if (age < 25) return '18–24';
  if (age < 35) return '25–34';
  if (age < 45) return '35–44';
  return '45+';
}

/** "Jaipur, Rajasthan" and "jaipur" both count as Jaipur. */
export const cityOf = (location: string | null) => {
  const c = (location ?? '').split(',')[0].trim();
  return c ? titleCase(c.slice(0, 40)) : 'Not shared';
};

/**
 * The Insights tab beyond the basics (blueprint 3.7). Everything about shoppers is aggregate: no
 * names, photos or wardrobes, small groups folded away, and platform-wide trends cached so they cost
 * one query per ten minutes, not per brand.
 */
@Injectable()
export class BrandInsightsService {
  private readonly platform = new TtlCache<unknown>(10 * 60_000, 20);

  constructor(private readonly prisma: PrismaService) {}

  /** Each piece's try-ons against its buy clicks, most tried-on first. */
  async conversion(brandId: string, days: number) {
    const since = new Date(Date.now() - days * DAY);
    const rows = await this.prisma.$queryRaw<{ productId: string; drapes: number; clicks: number; views: number }[]>(Prisma.sql`
      SELECT "productId",
             COUNT(*) FILTER (WHERE "type" = 'DRAPE')::int AS drapes,
             COUNT(*) FILTER (WHERE "type" = 'CLICK')::int AS clicks,
             COUNT(*) FILTER (WHERE "type" = 'PRODUCT_VIEW')::int AS views
      FROM "BrandEvent" WHERE "brandId" = ${brandId} AND "productId" IS NOT NULL AND "createdAt" >= ${since}
      GROUP BY "productId" ORDER BY drapes DESC, views DESC LIMIT 20`);
    const names = await this.prisma.brandProduct.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, title: true, images: true, price: true } });
    const by = new Map(names.map((n) => [n.id, n]));
    return rows.flatMap((r) => {
      const p = by.get(r.productId);
      return p ? [{ id: p.id, title: p.title, image: p.images[0] ?? '', price: p.price, views: r.views, drapes: r.drapes, clicks: r.clicks, clickRate: r.drapes ? Math.round((r.clicks / r.drapes) * 1000) / 10 : null }] : [];
    });
  }

  /** Platform-wide: which occasions shoppers are trying pieces on for, this week against last, with price and colour. */
  occasionDemand() {
    return this.platform.get('occasions', async () => {
      const now = Date.now();
      const rows = await this.prisma.$queryRaw<{ occasion: string; this_week: number; last_week: number; under2k: number; to5k: number; to10k: number; over10k: number }[]>(Prisma.sql`
        SELECT o AS occasion,
               COUNT(*) FILTER (WHERE e."createdAt" >= ${new Date(now - 7 * DAY)})::int AS this_week,
               COUNT(*) FILTER (WHERE e."createdAt" < ${new Date(now - 7 * DAY)})::int AS last_week,
               COUNT(*) FILTER (WHERE e."createdAt" >= ${new Date(now - 7 * DAY)} AND p."price" < 2000)::int AS under2k,
               COUNT(*) FILTER (WHERE e."createdAt" >= ${new Date(now - 7 * DAY)} AND p."price" >= 2000 AND p."price" < 5000)::int AS to5k,
               COUNT(*) FILTER (WHERE e."createdAt" >= ${new Date(now - 7 * DAY)} AND p."price" >= 5000 AND p."price" < 10000)::int AS to10k,
               COUNT(*) FILTER (WHERE e."createdAt" >= ${new Date(now - 7 * DAY)} AND p."price" >= 10000)::int AS over10k
        FROM "BrandEvent" e JOIN "BrandProduct" p ON p."id" = e."productId", unnest(p."occasions") AS o
        WHERE e."type" IN ('DRAPE', 'SAVE') AND e."createdAt" >= ${new Date(now - 14 * DAY)}
        GROUP BY o ORDER BY this_week DESC LIMIT 10`);
      const colours = await this.prisma.$queryRaw<{ occasion: string; colour: string; n: number }[]>(Prisma.sql`
        SELECT o AS occasion, lower(c) AS colour, COUNT(*)::int AS n
        FROM "BrandEvent" e JOIN "BrandProduct" p ON p."id" = e."productId", unnest(p."occasions") AS o, unnest(p."colors") AS c
        WHERE e."type" IN ('DRAPE', 'SAVE') AND e."createdAt" >= ${new Date(now - 7 * DAY)}
        GROUP BY o, lower(c) ORDER BY n DESC`);
      return rows.map((r) => {
        const bands = [
          ['Under ₹2,000', r.under2k],
          ['₹2,000–5,000', r.to5k],
          ['₹5,000–10,000', r.to10k],
          ['₹10,000+', r.over10k],
        ] as const;
        const top = [...bands].sort((a, b) => b[1] - a[1])[0];
        return {
          occasion: r.occasion,
          thisWeek: r.this_week,
          lastWeek: r.last_week,
          growth: growth(r.this_week, r.last_week),
          topPriceBand: top[1] > 0 ? top[0] : null,
          topColours: colours.filter((c) => c.occasion === r.occasion).slice(0, 3).map((c) => titleCase(c.colour)),
        };
      });
    });
  }

  /** What shoppers' wardrobes are missing for each occasion, from the planner (anonymous). */
  wardrobeGaps() {
    return this.platform.get('gaps', async () => {
      const rows = await this.prisma.plannerGap.groupBy({ by: ['occasion', 'item'], where: { createdAt: { gte: new Date(Date.now() - 30 * DAY) } }, _count: { _all: true }, orderBy: { _count: { item: 'desc' } }, take: 40 });
      return rows.filter((r) => r._count._all >= MIN_COUNT).slice(0, 15).map((r) => ({ occasion: r.occasion, item: r.item, mentions: r._count._all }));
    });
  }

  /** Platform-wide colours and categories shoppers try on, this week against last. */
  trends() {
    return this.platform.get('trends', async () => {
      const now = Date.now();
      const q = (field: 'colors' | 'category') =>
        this.prisma.$queryRaw<{ label: string; this_week: number; last_week: number }[]>(
          field === 'colors'
            ? Prisma.sql`
              SELECT lower(c) AS label,
                     COUNT(*) FILTER (WHERE e."createdAt" >= ${new Date(now - 7 * DAY)})::int AS this_week,
                     COUNT(*) FILTER (WHERE e."createdAt" < ${new Date(now - 7 * DAY)})::int AS last_week
              FROM "BrandEvent" e JOIN "BrandProduct" p ON p."id" = e."productId", unnest(p."colors") AS c
              WHERE e."type" = 'DRAPE' AND e."createdAt" >= ${new Date(now - 14 * DAY)}
              GROUP BY lower(c) ORDER BY this_week DESC LIMIT 10`
            : Prisma.sql`
              SELECT p."category" AS label,
                     COUNT(*) FILTER (WHERE e."createdAt" >= ${new Date(now - 7 * DAY)})::int AS this_week,
                     COUNT(*) FILTER (WHERE e."createdAt" < ${new Date(now - 7 * DAY)})::int AS last_week
              FROM "BrandEvent" e JOIN "BrandProduct" p ON p."id" = e."productId"
              WHERE e."type" = 'DRAPE' AND e."createdAt" >= ${new Date(now - 14 * DAY)}
              GROUP BY p."category" ORDER BY this_week DESC LIMIT 10`,
        );
      const [colours, categories] = await Promise.all([q('colors'), q('category')]);
      const shape = (r: { label: string; this_week: number; last_week: number }) => ({ label: titleCase(r.label), thisWeek: r.this_week, growth: growth(r.this_week, r.last_week) });
      return { colours: colours.map(shape), categories: categories.map(shape) };
    });
  }

  /**
   * Who engages with the brand, in aggregate: city, age group and gender of shoppers who tried on,
   * saved or shared its pieces, or followed it, in the last 90 days.
   */
  async audience(brandId: string) {
    const since = new Date(Date.now() - 90 * DAY);
    const [events, follows] = await Promise.all([
      this.prisma.brandEvent.findMany({ where: { brandId, userId: { not: null }, type: { in: ['DRAPE', 'SAVE', 'SHARE'] }, createdAt: { gte: since } }, select: { userId: true }, distinct: ['userId'], take: 20_000 }),
      this.prisma.brandFollow.findMany({ where: { brandId }, select: { userId: true }, take: 20_000 }),
    ]);
    const ids = [...new Set([...events.map((e) => e.userId as string), ...follows.map((f) => f.userId)])];
    if (ids.length < MIN_AUDIENCE) return { enough: false as const, total: ids.length, needed: MIN_AUDIENCE };
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { location: true, twinProfile: { select: { age: true, gender: true } } } });
    const city = new Map<string, number>();
    const age = new Map<string, number>();
    const gender = new Map<string, number>();
    const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
    for (const u of users) {
      bump(city, cityOf(u.location));
      bump(age, ageBucket(u.twinProfile?.age ?? null));
      const g = (u.twinProfile?.gender ?? '').trim().toLowerCase();
      bump(gender, g.startsWith('f') || g === 'woman' ? 'Women' : g.startsWith('m') || g === 'man' ? 'Men' : g ? 'Other' : 'Not shared');
    }
    return { enough: true as const, total: users.length, cities: anonymise(city, users.length).slice(0, 8), ages: anonymise(age, users.length), genders: anonymise(gender, users.length) };
  }

  /** The brand's try-ons per live piece in each of its categories, against the average of other brands in that category. */
  async benchmark(brandId: string) {
    const since = new Date(Date.now() - 30 * DAY);
    const rows = await this.prisma.$queryRaw<{ category: string; mine: boolean; drapes: number; pieces: number }[]>(Prisma.sql`
      SELECT p."category", (p."brandId" = ${brandId}) AS mine,
             COUNT(e."id")::int AS drapes, COUNT(DISTINCT p."id")::int AS pieces
      FROM "BrandProduct" p
      LEFT JOIN "BrandEvent" e ON e."productId" = p."id" AND e."type" = 'DRAPE' AND e."createdAt" >= ${since}
      WHERE p."status" = 'PUBLISHED' AND p."category" IN (SELECT DISTINCT "category" FROM "BrandProduct" WHERE "brandId" = ${brandId} AND "status" = 'PUBLISHED')
      GROUP BY p."category", (p."brandId" = ${brandId})`);
    const cats = [...new Set(rows.map((r) => r.category))];
    return cats
      .map((category) => {
        const me = rows.find((r) => r.category === category && r.mine);
        const rest = rows.find((r) => r.category === category && !r.mine);
        const mine = me && me.pieces ? Math.round((me.drapes / me.pieces) * 10) / 10 : 0;
        const average = rest && rest.pieces ? Math.round((rest.drapes / rest.pieces) * 10) / 10 : null;
        return { category, mine, average, pieces: me?.pieces ?? 0, vsAverage: average ? Math.round(((mine - average) / average) * 100) : null };
      })
      .sort((a, b) => b.pieces - a.pieces);
  }

  /** What shoppers searched for before opening the store. */
  async searchTerms(brandId: string, days: number) {
    const rows = await this.prisma.brandEvent.groupBy({
      by: ['query'],
      where: { brandId, type: 'STORE_VIEW', query: { not: null }, createdAt: { gte: new Date(Date.now() - days * DAY) } },
      _count: { _all: true },
      orderBy: { _count: { query: 'desc' } },
      take: 30,
    });
    return rows.filter((r) => r.query && r._count._all >= 2).slice(0, 15).map((r) => ({ term: r.query as string, visits: r._count._all }));
  }
}
