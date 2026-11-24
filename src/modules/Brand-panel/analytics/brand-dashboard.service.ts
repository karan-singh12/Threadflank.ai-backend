import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RankingService } from '../ranking/ranking.service';
import { rankingTips } from '../ranking/ranking-formula';
import { LOW_STOCK_AT } from '../catalog/catalog-variants';

export type AlertTone = 'good' | 'warn' | 'info';
export interface DashboardAlert {
  id: string;
  tone: AlertTone;
  title: string;
  detail?: string;
  /** Where in the panel to act on it. */
  href?: string;
}

const DAY = 86_400_000;
/** A piece needs this many try-ons before its click-through is worth flagging. */
const MISSED_MIN_DRAPES = 5;
const MISSED_MAX_RATE = 0.05;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function inWords(ms: number) {
  const h = Math.round(ms / 3_600_000);
  return h < 24 ? `${plural(Math.max(1, h), 'hour')}` : `${plural(Math.round(h / 24), 'day')}`;
}

/** The dashboard's "what should I look at" layer: rank, the pieces that slip, and alerts. */
@Injectable()
export class BrandDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rankings: RankingService,
  ) {}

  /** Rank, score, the gap to the next place, and the few things most likely to raise it. */
  async ranking(brandId: string) {
    const [standing, upcoming, photosNeedingWork, noBuyLink] = await Promise.all([
      this.rankings.forBrand(brandId),
      this.prisma.brandDrop.count({ where: { brandId, launchDate: { gt: new Date() } } }),
      this.prisma.brandProduct.count({ where: { brandId, status: 'PUBLISHED', drapeCheckedAt: { not: null }, drapeScore: { lt: 70 } } }),
      this.prisma.brandProduct.count({ where: { brandId, status: 'PUBLISHED', buyUrl: '' } }),
    ]);
    return { ...standing, tips: rankingTips(standing.breakdown, { upcomingLaunch: upcoming > 0, photosNeedingWork, noBuyLink }).slice(0, 4) };
  }

  /** Pieces shoppers try on a lot but rarely click through to buy: a price, size or photo question. */
  async missed(brandId: string, days = 30, limit = 5) {
    const since = new Date(Date.now() - days * DAY);
    const rows = await this.prisma.$queryRaw<{ productId: string; drapes: number; clicks: number }[]>(Prisma.sql`
      SELECT "productId",
             COUNT(*) FILTER (WHERE "type" = 'DRAPE')::int AS drapes,
             COUNT(*) FILTER (WHERE "type" = 'CLICK')::int AS clicks
      FROM "BrandEvent"
      WHERE "brandId" = ${brandId} AND "productId" IS NOT NULL AND "createdAt" >= ${since} AND "type" IN ('DRAPE', 'CLICK')
      GROUP BY "productId"
      HAVING COUNT(*) FILTER (WHERE "type" = 'DRAPE') >= ${MISSED_MIN_DRAPES}`);
    const slipping = rows
      .map((r) => ({ ...r, rate: r.clicks / r.drapes }))
      .filter((r) => r.rate < MISSED_MAX_RATE)
      .sort((a, b) => b.drapes - a.drapes)
      .slice(0, limit);
    if (slipping.length === 0) return [];
    const pieces = await this.prisma.brandProduct.findMany({ where: { brandId, id: { in: slipping.map((s) => s.productId) } }, select: { id: true, title: true, images: true, price: true, stock: true, buyUrl: true } });
    const by = new Map(pieces.map((p) => [p.id, p]));
    return slipping.flatMap((s) => {
      const p = by.get(s.productId);
      if (!p) return [];
      const reason = !p.buyUrl ? 'No buy link set' : p.stock <= 0 ? 'Out of stock' : 'Check the price, sizes and first photo';
      return [{ id: p.id, title: p.title, image: p.images[0] ?? '', price: p.price, drapes: s.drapes, clicks: s.clicks, clickRate: Math.round(s.rate * 1000) / 10, reason }];
    });
  }

  /** Up to six alerts, most useful first. Each is worked out from live data, so nothing needs dismissing. */
  async alerts(brandId: string): Promise<DashboardAlert[]> {
    const now = Date.now();
    const out: DashboardAlert[] = [];

    const [trend, standing, soon, lowPopular, photos, noLink, missed] = await Promise.all([
      this.prisma.$queryRaw<{ productId: string; this_week: number; last_week: number }[]>(Prisma.sql`
        SELECT "productId",
               COUNT(*) FILTER (WHERE "createdAt" >= ${new Date(now - 7 * DAY)})::int AS this_week,
               COUNT(*) FILTER (WHERE "createdAt" < ${new Date(now - 7 * DAY)})::int AS last_week
        FROM "BrandEvent"
        WHERE "brandId" = ${brandId} AND "type" = 'DRAPE' AND "productId" IS NOT NULL AND "createdAt" >= ${new Date(now - 14 * DAY)}
        GROUP BY "productId" ORDER BY this_week DESC LIMIT 5`),
      this.rankings.forBrand(brandId),
      this.prisma.brandDrop.findMany({ where: { brandId, launchDate: { gt: new Date(now), lte: new Date(now + 2 * DAY) } }, orderBy: { launchDate: 'asc' } }),
      this.prisma.brandProduct.findMany({ where: { brandId, status: 'PUBLISHED', stock: { gt: 0, lte: LOW_STOCK_AT }, drapesCount: { gt: 0 } }, orderBy: { drapesCount: 'desc' }, take: 5, select: { id: true, title: true } }),
      this.prisma.brandProduct.count({ where: { brandId, drapeCheckedAt: { not: null }, drapeScore: { lt: 70 } } }),
      this.prisma.brandProduct.count({ where: { brandId, status: 'PUBLISHED', buyUrl: '' } }),
      this.missed(brandId, 30, 1),
    ]);

    // Launches first: they have a deadline.
    for (const d of soon) {
      const left = inWords(d.launchDate.getTime() - now);
      if (!d.bannerUrl) out.push({ id: `launch-banner-${d.id}`, tone: 'warn', title: `“${d.title}” launches in ${left} and has no banner`, detail: 'Add a banner so the launch page and the Latest Launches row look finished.', href: '/drops' });
      const pieces = await this.prisma.brandProduct.count({ where: { brandId, status: 'PUBLISHED', collection: { equals: d.collectionName, mode: 'insensitive' } } });
      if (pieces === 0) out.push({ id: `launch-pieces-${d.id}`, tone: 'warn', title: `“${d.title}” launches in ${left} with no live pieces`, detail: `Add pieces to the “${d.collectionName}” collection so there's something to shop when it goes live.`, href: '/catalog' });
    }

    const hot = trend.find((t) => t.this_week >= 5 && t.this_week >= 2 * t.last_week);
    if (hot) {
      const p = await this.prisma.brandProduct.findUnique({ where: { id: hot.productId }, select: { title: true } });
      if (p) out.push({ id: `trend-${hot.productId}`, tone: 'good', title: `${p.title} is trending`, detail: `${plural(hot.this_week, 'try-on')} this week${hot.last_week ? `, up from ${hot.last_week}` : ''}. A good one to feature or pin.`, href: '/store' });
    }

    if (standing.rank && standing.previous) {
      const diff = standing.previous.rank - standing.rank;
      if (diff !== 0) out.push({ id: 'rank', tone: diff > 0 ? 'good' : 'warn', title: `You're #${standing.rank} this month`, detail: `${diff > 0 ? 'Up' : 'Down'} from #${standing.previous.rank} last month.`, href: '/insights' });
    } else if (!standing.rank) {
      out.push({ id: 'rank', tone: 'info', title: 'Not ranked yet this month', detail: 'Every try-on, save, share and click-out counts towards your monthly rank.', href: '/insights' });
    }

    if (lowPopular.length) out.push({ id: 'low-stock', tone: 'warn', title: `${plural(lowPopular.length, 'popular piece')} almost out of stock`, detail: lowPopular.map((p) => p.title).slice(0, 3).join(', '), href: '/catalog' });
    if (missed[0]) out.push({ id: `missed-${missed[0].id}`, tone: 'info', title: `${missed[0].title}: tried on ${missed[0].drapes} times, rarely clicked`, detail: missed[0].reason, href: '/catalog' });
    if (photos) out.push({ id: 'photos', tone: 'warn', title: `${plural(photos, 'photo')} need work for try-on`, detail: 'A front view of the whole piece on a plain background gives the best try-on.', href: '/catalog' });
    if (noLink) out.push({ id: 'buy-links', tone: 'warn', title: `${plural(noLink, 'live piece')} without a buy link`, detail: "Shoppers who want to buy them have nowhere to go.", href: '/catalog' });

    return out.slice(0, 6);
  }
}
