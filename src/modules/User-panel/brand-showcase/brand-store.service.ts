import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { WITH_COUNTS, toPublicProduct, type PublicProduct } from '../../Brand-panel/catalog/brand-catalog.service';
import { BrandDropsService } from '../../Brand-panel/drops/brand-drops.service';
import { PUBLIC_BRAND_SELECT, publicSocialLinks, toPublicBrand } from '../../Admin-panel/brands/public-brand';
import { StoreCatalogQueryDto, type StoreSort } from './brand-store.dto';
import { TtlCache } from '../../../common/cache/ttl-cache';
import { decodeCursor as decode, encodeCursor, sliceByLimit } from '../../../common/pagination/cursor';

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;
const SHOWCASE_SIZE = 8;
const NEW_IN_SIZE = 12;
const text = (v: unknown) => (typeof v === 'string' ? v : '');
const LIVE = { status: 'PUBLISHED' } as const;

export interface StoreFacets {
  categories: { name: string; count: number; cover: string }[];
  occasions: { name: string; count: number }[];
  pieces: number;
  minPrice: number | null;
  maxPrice: number | null;
}

type Cursor = { c?: string; id: string; p?: number; f?: boolean };

export { encodeCursor };
export const decodeCursor = (raw: string) => decode<Cursor>(raw);

/** "Everything after this piece, in this order": the keyset condition that makes deep pages as cheap as the first. */
export function afterCursor(sort: StoreSort, cur: Cursor): Prisma.BrandProductWhereInput {
  const when = cur.c ? new Date(cur.c) : undefined;
  switch (sort) {
    case 'price_asc':
      return { OR: [{ price: { gt: cur.p ?? 0 } }, { price: cur.p ?? 0, id: { gt: cur.id } }] };
    case 'price_desc':
      return { OR: [{ price: { lt: cur.p ?? 0 } }, { price: cur.p ?? 0, id: { lt: cur.id } }] };
    case 'featured':
      return cur.f
        ? { OR: [{ featured: true, createdAt: { lt: when } }, { featured: true, createdAt: when, id: { lt: cur.id } }, { featured: false }] }
        : { OR: [{ featured: false, createdAt: { lt: when } }, { featured: false, createdAt: when, id: { lt: cur.id } }] };
    default:
      return { OR: [{ createdAt: { lt: when } }, { createdAt: when, id: { lt: cur.id } }] };
  }
}

export function orderFor(sort: StoreSort): Prisma.BrandProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ price: 'asc' }, { id: 'asc' }];
    case 'price_desc':
      return [{ price: 'desc' }, { id: 'desc' }];
    case 'featured':
      return [{ featured: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }];
    default:
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}

/**
 * A brand's virtual store: one call for the page header, showcase and filters, and a filtered,
 * cursor-paginated feed of its pieces. Built for brands with hundreds of pieces: every query is
 * bounded by the page size, and the filter counts are cached for a minute.
 */
@Injectable()
export class BrandStoreService {
  private readonly facetsCache = new TtlCache<StoreFacets>(60_000, 1000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly drops: BrandDropsService,
  ) {}

  private async liveBrand(slug: string) {
    const brand = await this.prisma.brand.findFirst({ where: { slug, isDeleted: false, status: 'ACTIVE' }, select: { ...PUBLIC_BRAND_SELECT, createdAt: true } });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  /** Marks which of these pieces the signed-in shopper has liked. */
  private async withViewer(rows: Parameters<typeof toPublicProduct>[0][], userId?: string): Promise<PublicProduct[]> {
    const products = rows.map(toPublicProduct);
    if (!userId || products.length === 0) return products;
    const liked = new Set((await this.prisma.brandProductLike.findMany({ where: { userId, productId: { in: products.map((p) => p.id) } }, select: { productId: true } })).map((l) => l.productId));
    return products.map((p) => ({ ...p, likedByMe: liked.has(p.id) }));
  }

  private facets(brandId: string): Promise<StoreFacets> {
    return this.facetsCache.get(brandId, async () => {
      const [cats, covers, occ, price, pieces] = await Promise.all([
        this.prisma.brandProduct.groupBy({ by: ['category'], where: { brandId, ...LIVE }, _count: { _all: true } }),
        this.prisma.$queryRaw<{ category: string; cover: string }[]>(Prisma.sql`
          SELECT DISTINCT ON (category) category, images[1] AS cover
          FROM "BrandProduct" WHERE "brandId" = ${brandId} AND status = 'PUBLISHED' AND cardinality(images) > 0
          ORDER BY category, featured DESC, "createdAt" DESC`),
        this.prisma.$queryRaw<{ name: string; n: bigint }[]>(Prisma.sql`
          SELECT o AS name, count(*) AS n FROM "BrandProduct", unnest(occasions) AS o
          WHERE "brandId" = ${brandId} AND status = 'PUBLISHED' GROUP BY o ORDER BY n DESC, o ASC`),
        this.prisma.brandProduct.aggregate({ where: { brandId, ...LIVE, price: { gt: 0 } }, _min: { price: true }, _max: { price: true } }),
        this.prisma.brandProduct.count({ where: { brandId, ...LIVE } }),
      ]);
      const coverBy = new Map(covers.map((c) => [c.category, c.cover]));
      return {
        categories: cats.map((c) => ({ name: c.category, count: c._count._all, cover: coverBy.get(c.category) ?? '' })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        occasions: occ.map((o) => ({ name: o.name, count: Number(o.n) })),
        pieces,
        minPrice: price._min.price ?? null,
        maxPrice: price._max.price ?? null,
      };
    });
  }

  /** Everything the top of a store page needs, in one request. */
  async store(slug: string, userId?: string) {
    const brand = await this.liveBrand(slug);
    const [facets, featured, newest, drops] = await Promise.all([
      this.facets(brand.id),
      this.prisma.brandProduct.findMany({ where: { brandId: brand.id, ...LIVE, featured: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: SHOWCASE_SIZE, include: WITH_COUNTS }),
      this.prisma.brandProduct.findMany({ where: { brandId: brand.id, ...LIVE }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: NEW_IN_SIZE, include: WITH_COUNTS }),
      this.drops.listPublic(brand.id, userId),
    ]);

    // No featured pieces yet: the showcase shows what is newest, and says so.
    const isFallback = featured.length === 0;
    const [showcase, newIn] = await Promise.all([this.withViewer(isFallback ? newest.slice(0, 6) : featured, userId), this.withViewer(newest, userId)]);
    const social = publicSocialLinks(brand.socialLinks);
    const cover = showcase.find((p) => p.images[0])?.images[0] ?? '';

    return {
      brand: {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        logo: brand.logoUrl ?? '',
        banner: text(social.banner) || cover,
        tagline: (brand.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
        story: brand.description ?? '',
        category: brand.category ?? '',
        isVerified: brand.isVerified,
        websiteUrl: brand.websiteUrl || text(social.website),
        themeAccent: text(social.themeAccent),
        announcementText: text(social.announcementText),
        flagshipAddress: text(social.flagshipAddress),
        isOnlineOnly: social.isOnlineOnly !== false,
        links: Object.fromEntries(['instagram', 'facebook', 'twitter', 'youtube', 'tiktok', 'pinterest'].filter((k) => text(social[k])).map((k) => [k, text(social[k])])),
        memberSince: brand.createdAt.toISOString(),
      },
      stats: { pieces: facets.pieces, categories: facets.categories.length, occasions: facets.occasions.length, minPrice: facets.minPrice, maxPrice: facets.maxPrice, upcomingDrops: drops.filter((d) => d.status === 'scheduled').length },
      facets,
      showcase: { pieces: showcase, isFallback },
      newIn,
      drops,
    };
  }

  /** One page of a brand's live pieces: filtered, sorted, and reached by cursor so page 40 costs the same as page 1. */
  async catalog(slug: string, q: StoreCatalogQueryDto, userId?: string) {
    const brand = await this.liveBrand(slug);
    const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const sort: StoreSort = q.sort ?? 'new';

    const where: Prisma.BrandProductWhereInput = { brandId: brand.id, ...LIVE };
    const term = q.q?.trim();
    if (term) where.OR = [{ title: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }, { category: { contains: term, mode: 'insensitive' } }];
    if (q.category?.trim()) where.category = { equals: q.category.trim(), mode: 'insensitive' };
    if (q.occasion?.trim()) where.occasions = { has: q.occasion.trim() };
    if (q.minPrice !== undefined || q.maxPrice !== undefined) where.price = { ...(q.minPrice !== undefined ? { gte: q.minPrice } : {}), ...(q.maxPrice !== undefined ? { lte: q.maxPrice } : {}) };
    if (q.inStock) where.stock = { gt: 0 };

    const page: Prisma.BrandProductWhereInput = q.cursor ? { AND: [where, afterCursor(sort, decodeCursor(q.cursor))] } : where;
    const [rows, total] = await Promise.all([
      this.prisma.brandProduct.findMany({ where: page, orderBy: orderFor(sort), take: limit + 1, include: WITH_COUNTS }),
      // The total is only worked out for the first page; later pages are about "more", not "how many".
      q.cursor ? Promise.resolve(null) : this.prisma.brandProduct.count({ where }),
    ]);

    const { page: pageRows, more } = sliceByLimit(rows, limit);
    const last = pageRows[pageRows.length - 1];
    const nextCursor = more && last ? encodeCursor({ id: last.id, c: last.createdAt.toISOString(), p: last.price, f: last.featured }) : null;

    return { brand: toPublicBrand(brand), products: await this.withViewer(pageRows, userId), nextCursor, total };
  }
}
