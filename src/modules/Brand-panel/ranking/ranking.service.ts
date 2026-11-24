import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BrandNotifyService } from '../notify/brand-notify';
import { TtlCache } from '../../../common/cache/ttl-cache';
import { WITH_COUNTS, toPublicProduct } from '../catalog/brand-catalog.service';
import { Activity, Breakdown, Standing, monthKey, monthProgress, monthRange, nextRankGap, previousMonth, rankAll, scoreOf } from './ranking-formula';

/** Anonymous events count, but only up to this many per piece per day, so a script can't buy a rank. */
const ANON_CAP = { views: 500, other: 50 } as const;
const LIVE_STANDINGS_MS = 10 * 60_000;

type BrandCard = { id: string; name: string; slug: string; logo: string; category: string; isVerified: boolean };

/**
 * Monthly brand ranking. The current month is worked out on demand from shoppers' actions (cached
 * for ten minutes); once a month is over it is archived on the 1st, so past leaderboards never move.
 *
 * Trust rules applied before the formula: one shopper's repeat actions on the same piece count once
 * per day, accounts younger than a week and signed-out actions count half, and signed-out actions
 * are capped per piece per day.
 */
@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);
  private readonly live = new TtlCache<Standing[]>(LIVE_STANDINGS_MS, 4);
  /** The shopper-facing lists change slowly and are read on every Discover visit. */
  private readonly lists = new TtlCache<unknown>(5 * 60_000, 50);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly brandMail?: BrandNotifyService,
  ) {}

  // ── Standings ──────────────────────────────────────────────────────────

  /** The month's standings: live for the current month, archived for past ones (archived on first use if missing). */
  async standings(month = monthKey()): Promise<Standing[]> {
    if (month === monthKey()) return this.live.get(month, () => this.compute(month));
    const archived = await this.prisma.brandRanking.findMany({ where: { month }, orderBy: { rank: 'asc' } });
    if (archived.length) return archived.map((r) => ({ brandId: r.brandId, score: r.score, rank: r.rank, breakdown: r.breakdown as unknown as Breakdown }));
    if (monthRange(month).start.getTime() > Date.now()) return [];
    return this.archive(month);
  }

  /** Works the month out from the event log. */
  async compute(month: string): Promise<Standing[]> {
    const { start, end } = monthRange(month);
    const until = new Date(Math.min(end.getTime(), Date.now()));
    const [points, pieces, launches, brands] = await Promise.all([
      this.prisma.$queryRaw<{ brandId: string; type: string; pts: number }[]>(Prisma.sql`
        WITH ev AS (
          SELECT e."brandId", e."type"::text AS type, e."productId", e."userId",
                 date_trunc('day', e."createdAt" + interval '330 minutes') AS day,
                 CASE WHEN e."userId" IS NULL THEN 0.5
                      WHEN u."createdAt" > e."createdAt" - interval '7 days' THEN 0.5
                      ELSE 1.0 END AS w
          FROM "BrandEvent" e LEFT JOIN "User" u ON u."id" = e."userId"
          WHERE e."createdAt" >= ${start} AND e."createdAt" < ${end}
        ), grouped AS (
          SELECT "brandId", type, ("userId" IS NULL) AS anon, MAX(w) AS w, COUNT(*) AS n
          FROM ev GROUP BY "brandId", type, "productId", "userId", day
        )
        SELECT "brandId", type,
               SUM(CASE WHEN anon THEN LEAST(n, CASE WHEN type IN ('STORE_VIEW', 'PRODUCT_VIEW') THEN ${ANON_CAP.views} ELSE ${ANON_CAP.other} END) * w ELSE w END)::float AS pts
        FROM grouped GROUP BY "brandId", type`),
      this.prisma.brandProduct.groupBy({ by: ['brandId'], where: { status: 'PUBLISHED' }, _count: { _all: true } }),
      this.prisma.brandDrop.groupBy({ by: ['brandId'], where: { launchDate: { gte: start, lt: until } }, _count: { _all: true } }),
      this.prisma.brand.findMany({ where: { isDeleted: false, status: 'ACTIVE' }, select: { id: true } }),
    ]);

    const live = new Set(brands.map((b) => b.id));
    const act = new Map<string, Activity>();
    const get = (id: string) => act.get(id) ?? act.set(id, { drapes: 0, saves: 0, shares: 0, clicks: 0, views: 0, launches: 0, livePieces: 0 }).get(id)!;
    for (const p of points) {
      if (!live.has(p.brandId)) continue;
      const a = get(p.brandId);
      const n = Number(p.pts);
      if (p.type === 'DRAPE') a.drapes += n;
      else if (p.type === 'SAVE') a.saves += n;
      else if (p.type === 'SHARE') a.shares += n;
      else if (p.type === 'CLICK') a.clicks += n;
      else a.views += n;
    }
    for (const l of launches) if (live.has(l.brandId)) get(l.brandId).launches += l._count._all;
    for (const p of pieces) if (act.has(p.brandId)) act.get(p.brandId)!.livePieces = p._count._all;
    return rankAll([...act.entries()].map(([brandId, a]) => ({ brandId, breakdown: scoreOf(a) })));
  }

  /** Writes a finished month's standings. Safe to run twice: the month's rows are replaced together. */
  async archive(month: string): Promise<Standing[]> {
    const standings = await this.compute(month);
    await this.prisma.$transaction([
      this.prisma.brandRanking.deleteMany({ where: { month } }),
      this.prisma.brandRanking.createMany({
        data: standings.map((s) => ({ month, brandId: s.brandId, score: s.score, rank: s.rank, breakdown: s.breakdown as unknown as Prisma.InputJsonValue })),
        // Two instances archiving the same month at once write identical rows; the second simply skips them.
        skipDuplicates: true,
      }),
    ]);
    return standings;
  }

  /** 00:15 India time on the 1st: the month that just ended becomes final. */
  @Cron('15 0 1 * *', { timeZone: 'Asia/Kolkata' })
  async archiveLastMonth() {
    const month = previousMonth(monthKey());
    try {
      const rows = await this.archive(month);
      this.live.clear();
      this.logger.log(`Archived ${rows.length} brand rankings for ${month}`);
      this.emailFinalRanks(month, rows);
    } catch (e) {
      this.logger.error(`Archiving rankings for ${month} failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  /** Tells each ranked brand where it finished (brands can switch this off in Settings). */
  private emailFinalRanks(month: string, rows: Standing[]) {
    const label = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    for (const r of rows) {
      this.brandMail?.send(r.brandId, 'ranking', {
        subject: `You finished #${r.rank} for ${label}`,
        lines: [`Your brand finished #${r.rank} of ${rows.length} on Threadflank for ${label}, with ${Math.round(r.score)} points.`, 'The breakdown shows which actions earned them.'],
        path: '/dashboard',
      });
    }
  }

  /** The brand's own standing this month, the gap to the next place, and last month for comparison. */
  async forBrand(brandId: string) {
    const month = monthKey();
    const [now, before] = await Promise.all([this.standings(month), this.standings(previousMonth(month)).catch(() => [] as Standing[])]);
    const me = now.find((s) => s.brandId === brandId) ?? null;
    const prev = before.find((s) => s.brandId === brandId) ?? null;
    return {
      month,
      monthProgress: Math.round(monthProgress(month) * 100) / 100,
      rank: me?.rank ?? null,
      of: now.length,
      score: me?.score ?? 0,
      breakdown: me?.breakdown ?? scoreOf({ drapes: 0, saves: 0, shares: 0, clicks: 0, views: 0, launches: 0, livePieces: 0 }),
      next: nextRankGap(now, brandId),
      previous: prev ? { month: previousMonth(month), rank: prev.rank, score: prev.score } : null,
    };
  }

  // ── Public lists ───────────────────────────────────────────────────────

  private async cards(ids: string[]): Promise<Map<string, BrandCard>> {
    const rows = await this.prisma.brand.findMany({ where: { id: { in: ids }, isDeleted: false, status: 'ACTIVE' }, select: { id: true, name: true, slug: true, logoUrl: true, category: true, isVerified: true } });
    return new Map(rows.map((b) => [b.id, { id: b.id, name: b.name, slug: b.slug, logo: b.logoUrl ?? '', category: b.category ?? '', isVerified: b.isVerified }]));
  }

  /** Top brands of a month, by score. Sponsored slots are a separate list and never appear here by paying. */
  async topBrands(month = monthKey(), limit = 20) {
    return this.lists.get(`brands:${month}:${limit}`, () => this.loadTopBrands(month, limit)) as ReturnType<RankingService['loadTopBrands']>;
  }

  private async loadTopBrands(month: string, limit: number) {
    const standings = (await this.standings(month)).slice(0, limit);
    const cards = await this.cards(standings.map((s) => s.brandId));
    return standings.flatMap((s) => {
      const brand = cards.get(s.brandId);
      return brand ? [{ rank: s.rank, score: s.score, brand }] : [];
    });
  }

  /** Pieces shoppers tried on most in the last `days` days (one per shopper per piece per day). */
  async mostDraped(days = 7, limit = 20) {
    return this.lists.get(`draped:${days}:${limit}`, () => this.loadMostDraped(days, limit)) as ReturnType<RankingService['loadMostDraped']>;
  }

  private async loadMostDraped(days: number, limit: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const top = await this.prisma.$queryRaw<{ productId: string; drapes: number }[]>(Prisma.sql`
      SELECT "productId", COUNT(*)::int AS drapes FROM (
        SELECT DISTINCT e."productId", COALESCE(e."userId", e."id") AS actor, date_trunc('day', e."createdAt" + interval '330 minutes') AS day
        FROM "BrandEvent" e WHERE e."type" = 'DRAPE' AND e."productId" IS NOT NULL AND e."createdAt" >= ${since}
      ) d GROUP BY "productId" ORDER BY drapes DESC LIMIT ${limit * 2}`);
    if (top.length === 0) return [];
    const rows = await this.prisma.brandProduct.findMany({
      where: { id: { in: top.map((t) => t.productId) }, status: 'PUBLISHED', brand: { isDeleted: false, status: 'ACTIVE' } },
      include: { ...WITH_COUNTS, brand: { select: { id: true, name: true, slug: true, logoUrl: true } } },
    });
    const by = new Map(rows.map((r) => [r.id, r]));
    return top
      .flatMap((t) => {
        const r = by.get(t.productId);
        return r ? [{ drapes: t.drapes, piece: toPublicProduct(r), brand: { id: r.brand.id, name: r.brand.name, slug: r.brand.slug, logo: r.brand.logoUrl ?? '' } }] : [];
      })
      .slice(0, limit);
  }

  /**
   * Launches of the last 30 days, ranked by what shoppers did with the launched collection since
   * it went live, plus how many were waiting for it.
   */
  async topLaunches(limit = 10) {
    return this.lists.get(`launches:${limit}`, () => this.loadTopLaunches(limit)) as ReturnType<RankingService['loadTopLaunches']>;
  }

  private async loadTopLaunches(limit: number) {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const drops = await this.prisma.brandDrop.findMany({
      where: { launchDate: { gte: since, lte: new Date() }, brand: { isDeleted: false, status: 'ACTIVE' } },
      include: { brand: { select: { id: true, name: true, slug: true, logoUrl: true } }, _count: { select: { waitlist: true } } },
      orderBy: { launchDate: 'desc' },
      take: 100,
    });
    if (drops.length === 0) return [];
    const scored = await Promise.all(
      drops.map(async (d) => {
        const rows = await this.prisma.$queryRaw<{ type: string; n: number }[]>(Prisma.sql`
          SELECT e."type"::text AS type, COUNT(*)::int AS n
          FROM "BrandEvent" e JOIN "BrandProduct" p ON p."id" = e."productId"
          WHERE e."brandId" = ${d.brandId} AND e."createdAt" >= ${d.launchDate}
            AND lower(p."collection") = lower(${d.collectionName})
          GROUP BY e."type"`);
        const n = (t: string) => rows.find((r) => r.type === t)?.n ?? 0;
        const score = n('DRAPE') * 4 + n('SAVE') * 3 + n('SHARE') * 3 + n('CLICK') * 2 + d._count.waitlist;
        return { d, score };
      }),
    );
    return scored
      .filter((x) => x.score > 0 || x.d._count.waitlist > 0)
      .sort((a, b) => b.score - a.score || b.d.launchDate.getTime() - a.d.launchDate.getTime())
      .slice(0, limit)
      .map(({ d, score }) => ({
        score,
        drop: { id: d.id, title: d.title, collectionName: d.collectionName, launchDate: d.launchDate.toISOString(), bannerUrl: d.bannerUrl, waitlistCount: d._count.waitlist },
        brand: { id: d.brand.id, name: d.brand.name, slug: d.brand.slug, logo: d.brand.logoUrl ?? '' },
      }));
  }
}
