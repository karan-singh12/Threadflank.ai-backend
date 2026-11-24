import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { TtlCache } from '../../../common/cache/ttl-cache';
import { WITH_COUNTS, toPublicProduct } from '../catalog/brand-catalog.service';

const DAY = 86_400_000;
const LIVE = { status: 'PUBLISHED' } as const;

export interface WindowStats {
  views: number;
  drapes: number;
  saves: number;
  shares: number;
  clicks: number;
}

const brandCard = (b: { id: string; name: string; slug: string; logoUrl: string | null }) => ({ id: b.id, name: b.name, slug: b.slug, logo: b.logoUrl ?? '' });

/**
 * Launches beyond scheduling: the public launch page (countdown and teaser before, the collection
 * after), the Latest Launches feed, and the brand's report on how a launch went.
 */
@Injectable()
export class LaunchService {
  private readonly latestCache = new TtlCache<unknown>(2 * 60_000, 4);

  constructor(private readonly prisma: PrismaService) {}

  private window(brandId: string, collection: string, from: Date, to: Date): Promise<WindowStats> {
    return this.prisma
      .$queryRaw<{ type: string; n: number }[]>(Prisma.sql`
        SELECT e."type"::text AS type, COUNT(*)::int AS n
        FROM "BrandEvent" e JOIN "BrandProduct" p ON p."id" = e."productId"
        WHERE e."brandId" = ${brandId} AND lower(p."collection") = lower(${collection})
          AND e."createdAt" >= ${from} AND e."createdAt" < ${to}
        GROUP BY e."type"`)
      .then((rows) => {
        const n = (t: string) => rows.find((r) => r.type === t)?.n ?? 0;
        return { views: n('PRODUCT_VIEW'), drapes: n('DRAPE'), saves: n('SAVE'), shares: n('SHARE'), clicks: n('CLICK') };
      });
  }

  /**
   * How a launch did in its first 24 hours and first 7 days, and how many of the waitlist came
   * back to try a piece on. (Buy clicks are counted without knowing who clicked, so the waitlist
   * conversion is measured to try-on, not to click.)
   */
  async report(brandId: string, dropId: string) {
    const drop = await this.prisma.brandDrop.findFirst({ where: { id: dropId, brandId }, include: { _count: { select: { waitlist: true } } } });
    if (!drop) throw new NotFoundException('Drop not found.');
    const at = drop.launchDate.getTime();
    const now = Date.now();
    const pieces = await this.prisma.brandProduct.count({ where: { brandId, ...LIVE, collection: { equals: drop.collectionName, mode: 'insensitive' } } });
    const base = { dropId, title: drop.title, collectionName: drop.collectionName, launchDate: drop.launchDate.toISOString(), waitlist: drop._count.waitlist, livePieces: pieces };
    if (at > now) return { ...base, launched: false as const };

    const launch = new Date(at);
    const [day, week, converted] = await Promise.all([
      this.window(brandId, drop.collectionName, launch, new Date(Math.min(at + DAY, now))),
      this.window(brandId, drop.collectionName, launch, new Date(Math.min(at + 7 * DAY, now))),
      this.prisma.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT COUNT(DISTINCT w."userId")::int AS n
        FROM "DropWaitlistEntry" w
        JOIN "BrandEvent" e ON e."userId" = w."userId" AND e."type" = 'DRAPE' AND e."brandId" = ${brandId}
        JOIN "BrandProduct" p ON p."id" = e."productId" AND lower(p."collection") = lower(${drop.collectionName})
        WHERE w."dropId" = ${dropId} AND e."createdAt" >= ${launch} AND e."createdAt" < ${new Date(at + 7 * DAY)}`),
    ]);
    const tried = converted[0]?.n ?? 0;
    return {
      ...base,
      launched: true as const,
      first24h: day,
      first7d: week,
      /** True until the 7-day window has fully passed. */
      stillCounting: now < at + 7 * DAY,
      waitlistTriedOn: tried,
      waitlistConversion: drop._count.waitlist ? Math.round((tried / drop._count.waitlist) * 1000) / 10 : null,
      clickRate: week.drapes ? Math.round((week.clicks / week.drapes) * 1000) / 10 : null,
    };
  }

  /** The public launch page. Before launch: countdown, teaser and waitlist. After: the collection too. */
  async page(dropId: string, userId?: string) {
    const drop = await this.prisma.brandDrop.findFirst({
      where: { id: dropId, brand: { isDeleted: false, status: 'ACTIVE' } },
      include: { brand: { select: { id: true, name: true, slug: true, logoUrl: true, socialLinks: true } }, _count: { select: { waitlist: true } } },
    });
    if (!drop) throw new NotFoundException('Launch not found.');
    const launched = drop.launchDate.getTime() <= Date.now();
    const [joined, pieces] = await Promise.all([
      userId ? this.prisma.dropWaitlistEntry.count({ where: { dropId, userId } }).then((n) => n > 0) : Promise.resolve(false),
      // The collection stays a surprise until launch.
      launched
        ? this.prisma.brandProduct.findMany({
            where: { brandId: drop.brandId, ...LIVE, collection: { equals: drop.collectionName, mode: 'insensitive' } },
            orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
            take: 48,
            include: WITH_COUNTS,
          })
        : Promise.resolve([]),
    ]);
    const accent = (drop.brand.socialLinks as Record<string, unknown> | null)?.themeAccent;
    return {
      drop: {
        id: drop.id,
        title: drop.title,
        collectionName: drop.collectionName,
        description: drop.description ?? '',
        launchDate: drop.launchDate.toISOString(),
        bannerUrl: drop.bannerUrl,
        teaserUrl: drop.teaserUrl ?? '',
        waitlistCount: drop._count.waitlist,
        launched,
        joined,
      },
      brand: { ...brandCard(drop.brand), themeAccent: typeof accent === 'string' ? accent : '' },
      pieces: pieces.map(toPublicProduct),
    };
  }

  /** For the home page: launches of the last 30 days, newest first, and the ones coming up soonest. */
  async latest() {
    return this.latestCache.get('latest', async () => {
      const now = Date.now();
      const rows = await this.prisma.brandDrop.findMany({
        where: { launchDate: { gte: new Date(now - 30 * DAY), lte: new Date(now + 30 * DAY) }, brand: { isDeleted: false, status: 'ACTIVE' } },
        include: { brand: { select: { id: true, name: true, slug: true, logoUrl: true } }, _count: { select: { waitlist: true } } },
        orderBy: { launchDate: 'desc' },
        take: 60,
      });
      const shape = (d: (typeof rows)[number]) => ({
        id: d.id,
        title: d.title,
        collectionName: d.collectionName,
        launchDate: d.launchDate.toISOString(),
        bannerUrl: d.bannerUrl,
        teaserUrl: d.teaserUrl ?? '',
        waitlistCount: d._count.waitlist,
        brand: brandCard(d.brand),
      });
      return {
        live: rows.filter((d) => d.launchDate.getTime() <= now).slice(0, 20).map(shape),
        upcoming: rows
          .filter((d) => d.launchDate.getTime() > now)
          .sort((a, b) => a.launchDate.getTime() - b.launchDate.getTime())
          .slice(0, 20)
          .map(shape),
      };
    }) as Promise<{ live: unknown[]; upcoming: unknown[] }>;
  }
}
