import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { publicSocialLinks } from '../../Admin-panel/brands/public-brand';
import { DirectoryQueryDto } from './brand-store.dto';
import { TtlCache } from '../../../common/cache/ttl-cache';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;
const text = (v: unknown) => (typeof v === 'string' ? v : '');

export interface BrandCard {
  id: string;
  name: string;
  slug: string;
  logo: string;
  banner: string;
  category: string;
  isVerified: boolean;
  tagline: string;
  themeAccent: string;
  announcementText: string;
  piecesCount: number;
  previews: { id: string; image: string; title: string }[];
  /** ISO time of the brand's next drop, if one is coming. */
  nextDrop: string | null;
}

/**
 * The brands page for 1000+ brands: one page of cards at a time, searchable and filterable.
 * Every query is bounded by the page size: counts, previews and drops are fetched only for the brands on the page.
 */
@Injectable()
export class BrandDirectoryService {
  private readonly categoriesCache = new TtlCache<{ name: string; count: number }[]>(60_000, 4);

  constructor(private readonly prisma: PrismaService) {}

  async directory(q: DirectoryQueryDto) {
    const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const page = q.page ?? 1;
    const where: Prisma.BrandWhereInput = { isDeleted: false, status: 'ACTIVE' };
    if (q.q?.trim()) where.name = { contains: q.q.trim(), mode: 'insensitive' };
    if (q.category?.trim()) where.category = { equals: q.category.trim(), mode: 'insensitive' };
    if (q.withPieces !== false) where.products = { some: { status: 'PUBLISHED' } };

    const orderBy: Prisma.BrandOrderByWithRelationInput[] =
      q.sort === 'az' ? [{ name: 'asc' }, { id: 'asc' }] : q.sort === 'new' ? [{ createdAt: 'desc' }, { id: 'desc' }] : [{ isVerified: 'desc' }, { name: 'asc' }, { id: 'asc' }];

    const [rows, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: { id: true, name: true, slug: true, logoUrl: true, description: true, category: true, isVerified: true, socialLinks: true },
      }),
      this.prisma.brand.count({ where }),
    ]);

    const items = await this.enrich(rows);
    return { items, page, limit, total, hasMore: page * limit < total };
  }

  /** Counts, three preview photos and the next drop: for the brands on this page only. */
  private async enrich(rows: { id: string; name: string; slug: string; logoUrl: string | null; description: string | null; category: string | null; isVerified: boolean; socialLinks: unknown }[]): Promise<BrandCard[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [counts, previews, drops] = await Promise.all([
      this.prisma.brandProduct.groupBy({ by: ['brandId'], where: { brandId: { in: ids }, status: 'PUBLISHED' }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ brandId: string; id: string; title: string; image: string }[]>(Prisma.sql`
        SELECT "brandId", id, title, image FROM (
          SELECT "brandId", id, title, images[1] AS image,
                 row_number() OVER (PARTITION BY "brandId" ORDER BY featured DESC, "createdAt" DESC) AS rn
          FROM "BrandProduct"
          WHERE "brandId" IN (${Prisma.join(ids)}) AND status = 'PUBLISHED' AND cardinality(images) > 0
        ) t WHERE rn <= 3`),
      this.prisma.brandDrop.groupBy({ by: ['brandId'], where: { brandId: { in: ids }, launchDate: { gt: new Date() } }, _min: { launchDate: true } }),
    ]);
    const countBy = new Map(counts.map((c) => [c.brandId, c._count._all]));
    const dropBy = new Map(drops.map((d) => [d.brandId, d._min.launchDate]));
    const previewBy = new Map<string, { id: string; image: string; title: string }[]>();
    for (const p of previews) previewBy.set(p.brandId, [...(previewBy.get(p.brandId) ?? []), { id: p.id, image: p.image, title: p.title }]);

    return rows.map((r) => {
      const social = publicSocialLinks(r.socialLinks);
      const pv = previewBy.get(r.id) ?? [];
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        logo: r.logoUrl ?? '',
        // A real cover photo only: the brand's own banner, else its first piece. Never a stretched logo.
        banner: text(social.banner) || pv[0]?.image || '',
        category: r.category ?? '',
        isVerified: r.isVerified,
        tagline: (r.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
        themeAccent: text(social.themeAccent),
        announcementText: text(social.announcementText),
        piecesCount: countBy.get(r.id) ?? 0,
        previews: pv,
        nextDrop: dropBy.get(r.id)?.toISOString() ?? null,
      };
    });
  }

  /** The category chips on the brands page, with how many brands each has. Cached for a minute. */
  categories() {
    return this.categoriesCache.get('all', async () => {
      const rows = await this.prisma.brand.groupBy({
        by: ['category'],
        where: { isDeleted: false, status: 'ACTIVE', category: { not: null }, products: { some: { status: 'PUBLISHED' } } },
        _count: { _all: true },
      });
      // "Denim" and "denim" are one chip.
      const merged = new Map<string, { name: string; count: number }>();
      for (const r of rows) {
        const name = (r.category ?? '').replace(/\s+/g, ' ').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const cur = merged.get(key);
        merged.set(key, { name: cur?.name ?? name, count: (cur?.count ?? 0) + r._count._all });
      }
      return [...merged.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    });
  }
}
