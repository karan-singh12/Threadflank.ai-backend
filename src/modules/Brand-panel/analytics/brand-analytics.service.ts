import { Injectable } from '@nestjs/common';
import { BrandEventType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TrackClickDto } from '../dto/brand-common.dto';
import { BrandCatalogService } from '../catalog/brand-catalog.service';

/** `changePct` is null when the period before had nothing to compare with. */
export interface MetricDto {
  total: number;
  changePct: number | null;
}

export interface MetricSummaryDto {
  /** How many days these numbers cover; the change compares with the same number of days before. */
  periodDays: number;
  storeViews: MetricDto;
  totalDrapes: MetricDto;
  saves: MetricDto;
  shares: MetricDto;
  clickOuts: MetricDto;
  conversionRate: MetricDto;
  /** Shoppers who followed the brand in the period. */
  newFollowers: MetricDto;
}

const DAY = 86_400_000;
export const DEFAULT_PERIOD_DAYS = 30;

const metric = (total: number, previous: number): MetricDto => ({
  total,
  changePct: previous > 0 ? Number((((total - previous) / previous) * 100).toFixed(1)) : null,
});
const rate = (clicks: number, drapes: number) => (drapes > 0 ? Number(((clicks / drapes) * 100).toFixed(1)) : 0);

type Counts = Record<BrandEventType, number>;
const EMPTY: Counts = { STORE_VIEW: 0, PRODUCT_VIEW: 0, DRAPE: 0, SAVE: 0, SHARE: 0, CLICK: 0 };

@Injectable()
export class BrandAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: BrandCatalogService,
  ) {}

  private async counts(brandId: string, from: Date, to: Date): Promise<{ events: Counts; widget: { sessions: number; successful: number } }> {
    const range = { gte: from, lt: to };
    const [rows, sessions, successful] = await Promise.all([
      this.prisma.brandEvent.groupBy({ by: ['type'], where: { brandId, createdAt: range }, _count: { _all: true } }),
      this.prisma.brandWidgetSession.count({ where: { brandId, createdAt: range } }),
      this.prisma.brandWidgetSession.count({ where: { brandId, success: true, createdAt: range } }),
    ]);
    const events = { ...EMPTY };
    for (const r of rows) events[r.type] = r._count._all;
    return { events, widget: { sessions, successful } };
  }

  /**
   * What shoppers did with this brand in the last `days` days, against the same length before.
   * Views are store and piece views plus try-on widget sessions on the brand's own site; try-ons
   * are try-ons of its pieces on Threadflank plus successful widget sessions.
   */
  async getOverview(brandId: string, days = DEFAULT_PERIOD_DAYS): Promise<MetricSummaryDto> {
    const now = Date.now();
    const cut = new Date(now - days * DAY);
    const [cur, prev] = await Promise.all([this.counts(brandId, cut, new Date(now + 1000)), this.counts(brandId, new Date(now - 2 * days * DAY), cut)]);
    const [follows, prevFollows] = await Promise.all([
      this.prisma.brandFollow.count({ where: { brandId, createdAt: { gte: cut } } }),
      this.prisma.brandFollow.count({ where: { brandId, createdAt: { gte: new Date(now - 2 * days * DAY), lt: cut } } }),
    ]);

    const views = (c: typeof cur) => c.events.STORE_VIEW + c.events.PRODUCT_VIEW + c.widget.sessions;
    const drapes = (c: typeof cur) => c.events.DRAPE + c.widget.successful;

    return {
      periodDays: days,
      storeViews: metric(views(cur), views(prev)),
      totalDrapes: metric(drapes(cur), drapes(prev)),
      saves: metric(cur.events.SAVE, prev.events.SAVE),
      shares: metric(cur.events.SHARE, prev.events.SHARE),
      clickOuts: metric(cur.events.CLICK, prev.events.CLICK),
      conversionRate: metric(rate(cur.events.CLICK, drapes(cur)), rate(prev.events.CLICK, drapes(prev))),
      newFollowers: metric(follows, prevFollows),
    };
  }

  /** One row per day for the last `days` days (days with nothing are filled with zeros), for charts. */
  async getSeries(brandId: string, days = DEFAULT_PERIOD_DAYS) {
    // Days are UTC days everywhere (the query buckets in UTC and the labels are UTC dates), so they line up.
    const start = new Date(Date.now() - (days - 1) * DAY);
    const from = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const rows = await this.prisma.$queryRaw<{ day: Date; type: BrandEventType; n: bigint }[]>(Prisma.sql`
      SELECT date_trunc('day', "createdAt" AT TIME ZONE 'UTC') AS day, type, count(*) AS n
      FROM "BrandEvent" WHERE "brandId" = ${brandId} AND "createdAt" >= ${from}
      GROUP BY 1, 2 ORDER BY 1`);
    const byDay = new Map<string, Counts>();
    for (let i = 0; i < days; i++) byDay.set(new Date(from.getTime() + i * DAY).toISOString().slice(0, 10), { ...EMPTY });
    for (const r of rows) {
      const bucket = byDay.get(new Date(r.day).toISOString().slice(0, 10));
      if (bucket) bucket[r.type] = Number(r.n);
    }
    return [...byDay.entries()].map(([date, c]) => ({ date, views: c.STORE_VIEW + c.PRODUCT_VIEW, drapes: c.DRAPE, saves: c.SAVE, shares: c.SHARE, clicks: c.CLICK }));
  }

  /** The pieces shoppers reached for most in the last `days` days, for each kind of action. */
  async getTopPieces(brandId: string, days = DEFAULT_PERIOD_DAYS, limit = 5) {
    const since = new Date(Date.now() - days * DAY);
    const rows = await this.prisma.brandEvent.groupBy({
      by: ['productId', 'type'],
      where: { brandId, productId: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const score = new Map<string, { drapes: number; saves: number; shares: number; clicks: number; views: number }>();
    for (const r of rows) {
      const s = score.get(r.productId as string) ?? { drapes: 0, saves: 0, shares: 0, clicks: 0, views: 0 };
      const n = r._count._all;
      if (r.type === 'DRAPE') s.drapes += n;
      else if (r.type === 'SAVE') s.saves += n;
      else if (r.type === 'SHARE') s.shares += n;
      else if (r.type === 'CLICK') s.clicks += n;
      else if (r.type === 'PRODUCT_VIEW') s.views += n;
      score.set(r.productId as string, s);
    }
    // Same weights the ranking blueprint uses: try-on x4, save x3, share x3, click-out x2.
    const ranked = [...score.entries()]
      .map(([id, s]) => ({ id, ...s, score: s.drapes * 4 + s.saves * 3 + s.shares * 3 + s.clicks * 2 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    if (ranked.length === 0) return [];
    const pieces = await this.prisma.brandProduct.findMany({ where: { brandId, id: { in: ranked.map((r) => r.id) } }, select: { id: true, title: true, sku: true, images: true, price: true } });
    const by = new Map(pieces.map((p) => [p.id, p]));
    return ranked.flatMap((r) => {
      const p = by.get(r.id);
      return p ? [{ ...r, title: p.title, sku: p.sku, image: p.images[0] ?? '', price: p.price }] : [];
    });
  }

  /** What shoppers did, grouped by the category of the piece, for the last `days` days. */
  async getCategories(brandId: string, days = DEFAULT_PERIOD_DAYS) {
    const since = new Date(Date.now() - days * DAY);
    const rows = await this.prisma.$queryRaw<{ category: string | null; type: string; n: bigint }[]>`
      SELECT p."category" AS category, e."type"::text AS type, COUNT(*) AS n
      FROM "BrandEvent" e JOIN "BrandProduct" p ON p."id" = e."productId"
      WHERE e."brandId" = ${brandId} AND e."createdAt" >= ${since}
      GROUP BY p."category", e."type"`;
    const by = new Map<string, { category: string; views: number; drapes: number; saves: number; shares: number; clicks: number }>();
    for (const r of rows) {
      const key = r.category?.trim() || "Uncategorised";
      const s = by.get(key) ?? { category: key, views: 0, drapes: 0, saves: 0, shares: 0, clicks: 0 };
      const n = Number(r.n);
      if (r.type === "PRODUCT_VIEW") s.views += n;
      else if (r.type === "DRAPE") s.drapes += n;
      else if (r.type === "SAVE") s.saves += n;
      else if (r.type === "SHARE") s.shares += n;
      else if (r.type === "CLICK") s.clicks += n;
      by.set(key, s);
    }
    return [...by.values()].sort((a, b) => b.drapes * 4 + b.saves * 3 + b.shares * 3 + b.clicks * 2 - (a.drapes * 4 + a.saves * 3 + a.shares * 3 + a.clicks * 2));
  }

  async trackOutboundClick(brandId: string, dto: TrackClickDto) {
    const counted = await this.catalogService.incrementClick(brandId, dto.productId);
    return { success: counted, productId: dto.productId };
  }
}
