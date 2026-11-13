import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateGarmentDto, UpdateGarmentDto } from '../dto/brand-common.dto';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { BULK_MAX, BulkCatalogDto, CatalogPageQueryDto, CatalogSort } from './catalog-page.dto';
import { decodeCursor, encodeCursor, sliceByLimit } from '../../../common/pagination/cursor';

export interface ProductItemEntity {
  id: string;
  title: string;
  sku: string;
  price: number;
  originalPrice?: number;
  images: string[];
  category: string;
  occasions: string[];
  colors: string[];
  sizes: string[];
  stock: number;
  isDrapeReady: boolean;
  drapeScore: number;
  fitScore?: number;
  drapesCount: number;
  clicksCount: number;
  buyUrl: string;
  featured: boolean;
  newDrop: boolean;
  /** The brand's own grouping, e.g. "Wedding Edit 2026". */
  collection?: string;
  /** The caption: what a post used to say. */
  description?: string;
  /** DRAFT is hidden from shoppers; PUBLISHED is live. */
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "FAILED";
  sharesCount: number;
  likesCount: number;
  commentsCount: number;
}

/** A brand's showcase is a short, curated list, so only this many pieces can be featured at once. */
export const MAX_FEATURED = 8;

/** Pieces with at most this many left count as "low stock". */
export const LOW_STOCK_AT = 3;

type SortSpec = { field: 'createdAt' | 'price' | 'drapesCount' | 'stock'; dir: 'asc' | 'desc' };
const SORTS: Record<CatalogSort, SortSpec> = {
  newest: { field: 'createdAt', dir: 'desc' },
  oldest: { field: 'createdAt', dir: 'asc' },
  price_low: { field: 'price', dir: 'asc' },
  price_high: { field: 'price', dir: 'desc' },
  popular: { field: 'drapesCount', dir: 'desc' },
  stock_low: { field: 'stock', dir: 'asc' },
};

/** What the unpaged list returns at most, so one huge catalog cannot make a single response unbounded. */
const LEGACY_LIST_CAP = 1000;

export const WITH_COUNTS = { _count: { select: { likes: true, comments: true } } } as const;
type Row = Prisma.BrandProductGetPayload<{ include: typeof WITH_COUNTS }>;

const toEntity = (r: Row): ProductItemEntity => ({
  id: r.id,
  title: r.title,
  sku: r.sku,
  price: r.price,
  originalPrice: r.originalPrice ?? undefined,
  images: r.images,
  category: r.category,
  occasions: r.occasions,
  colors: r.colors,
  sizes: r.sizes,
  stock: r.stock,
  isDrapeReady: r.isDrapeReady,
  drapeScore: r.drapeScore,
  fitScore: r.fitScore ?? undefined,
  drapesCount: r.drapesCount,
  clicksCount: r.clicksCount,
  buyUrl: r.buyUrl,
  featured: r.featured,
  newDrop: r.newDrop,
  collection: r.collection ?? undefined,
  description: r.description ?? undefined,
  status: r.status,
  sharesCount: r.sharesCount,
  likesCount: r._count.likes,
  commentsCount: r._count.comments,
});

/** What a shopper sees of a garment: no SKU, no internal scores or counters. */
export interface PublicProduct {
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  images: string[];
  category: string;
  occasions: string[];
  colors: string[];
  sizes: string[];
  inStock: boolean;
  isDrapeReady: boolean;
  /** True when the brand has set a store link, so the shopper Buy button can be shown. */
  hasBuyLink: boolean;
  featured: boolean;
  newDrop: boolean;
  description?: string;
  likesCount: number;
  sharesCount: number;
  /** Whether the signed-in shopper liked it. Only set where the viewer is known. */
  likedByMe?: boolean;
}

export const toPublicProduct = (r: Row): PublicProduct => ({
  id: r.id,
  title: r.title,
  price: r.price,
  originalPrice: r.originalPrice ?? undefined,
  images: r.images,
  category: r.category,
  occasions: r.occasions,
  colors: r.colors,
  sizes: r.sizes,
  inStock: r.stock > 0,
  isDrapeReady: r.isDrapeReady,
  hasBuyLink: r.buyUrl.trim().length > 0,
  featured: r.featured,
  newDrop: r.newDrop,
  description: r.description ?? undefined,
  likesCount: r._count.likes,
  sharesCount: r.sharesCount,
});

/**
 * Every query is scoped by brandId, so one brand can never read or change another brand's garments.
 */
@Injectable()
export class BrandCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taxonomy: TaxonomyService,
  ) {}

  /** The whole catalog, newest first. Capped: a brand with more pieces than this must use findPage. */
  async findAll(brandId: string): Promise<ProductItemEntity[]> {
    const rows = await this.prisma.brandProduct.findMany({ where: { brandId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: LEGACY_LIST_CAP, include: WITH_COUNTS });
    return rows.map(toEntity);
  }

  private whereFor(brandId: string, q: CatalogPageQueryDto): Prisma.BrandProductWhereInput {
    const and: Prisma.BrandProductWhereInput[] = [{ brandId }];
    const term = q.q?.trim();
    if (term) and.push({ OR: [{ title: { contains: term, mode: 'insensitive' } }, { sku: { contains: term, mode: 'insensitive' } }, { collection: { contains: term, mode: 'insensitive' } }] });
    if (q.category?.trim()) and.push({ category: { equals: q.category.trim(), mode: 'insensitive' } });
    const col = q.collection?.trim();
    if (col) and.push(col.toLowerCase() === 'none' ? { collection: null } : { collection: { equals: col, mode: 'insensitive' } });
    if (q.status) and.push({ status: q.status });
    if (q.featured !== undefined) and.push({ featured: q.featured });
    if (q.outOfStock) and.push({ stock: { lte: 0 } });
    if (q.lowStock) and.push({ stock: { gt: 0, lte: LOW_STOCK_AT } });
    if (q.notReady) and.push({ isDrapeReady: false });
    return { AND: and };
  }

  /**
   * One page of the catalog reached by cursor, in the chosen sort. The cursor carries the last row's sort
   * value plus its id, so every page is one indexed seek however deep it is. The total rides on page one only.
   */
  async findPage(brandId: string, q: CatalogPageQueryDto) {
    const limit = q.limit ?? 24;
    const { field, dir } = SORTS[q.sort ?? 'newest'];
    const where = this.whereFor(brandId, q);

    let page: Prisma.BrandProductWhereInput = where;
    if (q.cursor) {
      const cur = decodeCursor<{ id: string; v: string | number }>(q.cursor);
      const v = field === 'createdAt' ? new Date(cur.v) : Number(cur.v);
      const bad = v instanceof Date ? Number.isNaN(v.getTime()) : Number.isNaN(v);
      if (bad) throw new BadRequestException('That page link is not valid. Reload the list.');
      const past = dir === 'desc' ? 'lt' : 'gt';
      page = { AND: [where, { OR: [{ [field]: { [past]: v } }, { [field]: v, id: { [past]: cur.id } }] }] };
    }
    const [rows, total] = await Promise.all([
      this.prisma.brandProduct.findMany({ where: page, orderBy: [{ [field]: dir }, { id: dir }], take: limit + 1, include: WITH_COUNTS }),
      q.cursor ? Promise.resolve(null) : this.prisma.brandProduct.count({ where }),
    ]);
    const { page: items, more } = sliceByLimit(rows, limit);
    const last = items[items.length - 1];
    const v = last ? (field === 'createdAt' ? last.createdAt.toISOString() : (last[field] as number)) : null;
    return { items: items.map(toEntity), nextCursor: more && last ? encodeCursor({ id: last.id, v }) : null, total };
  }

  /** The numbers the filter bar needs, from a few grouped counts instead of loading the catalog. */
  async facets(brandId: string) {
    const [categories, collections, statuses, outOfStock, lowStock, notReady, featured, total] = await Promise.all([
      this.prisma.brandProduct.groupBy({ by: ['category'], where: { brandId }, _count: { _all: true }, orderBy: { _count: { category: 'desc' } } }),
      this.prisma.brandProduct.groupBy({ by: ['collection'], where: { brandId }, _count: { _all: true } }),
      this.prisma.brandProduct.groupBy({ by: ['status'], where: { brandId }, _count: { _all: true } }),
      this.prisma.brandProduct.count({ where: { brandId, stock: { lte: 0 } } }),
      this.prisma.brandProduct.count({ where: { brandId, stock: { gt: 0, lte: LOW_STOCK_AT } } }),
      this.prisma.brandProduct.count({ where: { brandId, isDrapeReady: false } }),
      this.prisma.brandProduct.count({ where: { brandId, featured: true } }),
      this.prisma.brandProduct.count({ where: { brandId } }),
    ]);
    const named = collections
      .filter((c) => c.collection)
      .map((c) => ({ name: c.collection as string, count: c._count._all }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return {
      total,
      categories: categories.map((c) => ({ name: c.category, count: c._count._all })),
      collections: named,
      uncollected: collections.find((c) => !c.collection)?._count._all ?? 0,
      status: {
        published: statuses.find((x) => x.status === 'PUBLISHED')?._count._all ?? 0,
        draft: statuses.find((x) => x.status === 'DRAFT')?._count._all ?? 0,
      },
      outOfStock,
      lowStock,
      notReady,
      featured,
    };
  }

  /** One action on up to BULK_MAX pieces. Scoped by brandId, so foreign ids are simply not touched. */
  async bulk(brandId: string, dto: BulkCatalogDto) {
    const ids = [...new Set(dto.ids)].slice(0, BULK_MAX);
    const where = { id: { in: ids }, brandId };
    let count = 0;
    if (dto.action === 'delete') {
      count = (await this.prisma.brandProduct.deleteMany({ where })).count;
    } else if (dto.action === 'collection') {
      count = (await this.prisma.brandProduct.updateMany({ where, data: { collection: dto.collection?.trim() || null } })).count;
    } else if (dto.action === 'draft') {
      count = (await this.prisma.brandProduct.updateMany({ where, data: { status: 'DRAFT', featured: false } })).count;
    } else {
      // publishedAt is only stamped the first time a piece goes live.
      await this.prisma.brandProduct.updateMany({ where: { ...where, publishedAt: null }, data: { publishedAt: new Date() } });
      count = (await this.prisma.brandProduct.updateMany({ where, data: { status: 'PUBLISHED' } })).count;
    }
    this.taxonomy.invalidatePublic();
    return { action: dto.action, requested: ids.length, affected: count };
  }

  count(brandId: string) {
    return this.prisma.brandProduct.count({ where: { brandId } });
  }

  async findOne(brandId: string, id: string): Promise<ProductItemEntity> {
    const row = await this.prisma.brandProduct.findFirst({ where: { id, brandId }, include: WITH_COUNTS });
    if (!row) throw new NotFoundException(`Garment with ID ${id} not found in catalog.`);
    return toEntity(row);
  }

  private async assertFeaturedRoom(brandId: string) {
    const n = await this.prisma.brandProduct.count({ where: { brandId, featured: true } });
    if (n >= MAX_FEATURED) throw new BadRequestException(`You can feature up to ${MAX_FEATURED} pieces on your store page. Remove the star from one first.`);
  }

  async create(brandId: string, dto: CreateGarmentDto): Promise<ProductItemEntity> {
    if (dto.featured) await this.assertFeaturedRoom(brandId);
    const category = await this.taxonomy.requireCategory(dto.category);
    const occasions = await this.taxonomy.requireOccasions(dto.occasions ?? []);
    try {
      const row = await this.prisma.brandProduct.create({
        data: {
          brandId,
          title: dto.title,
          sku: dto.sku,
          price: dto.price,
          originalPrice: dto.originalPrice,
          images: dto.images ?? [],
          category,
          occasions,
          colors: dto.colors ?? [],
          sizes: dto.sizes ?? [],
          stock: dto.stock ?? 0,
          isDrapeReady: dto.isDrapeReady ?? false,
          drapeScore: dto.drapeScore ?? 0,
          buyUrl: dto.buyUrl,
          featured: dto.featured ?? false,
          newDrop: dto.newDrop ?? true,
          collection: dto.collection?.trim() || null,
          description: dto.description?.trim() || null,
          status: dto.status ?? "PUBLISHED",
          publishedAt: (dto.status ?? "PUBLISHED") === "PUBLISHED" ? new Date() : null,
        },
        include: WITH_COUNTS,
      });
      this.taxonomy.invalidatePublic();
      return toEntity(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`You already have a garment with SKU ${dto.sku}.`);
      }
      throw e;
    }
  }

  async update(brandId: string, id: string, dto: UpdateGarmentDto): Promise<ProductItemEntity> {
    const current = await this.findOne(brandId, id);
    if (dto.featured && !current.featured) await this.assertFeaturedRoom(brandId);
    const data = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Prisma.BrandProductUpdateInput;
    if (dto.description !== undefined) data.description = dto.description.trim() || null;
    if (dto.collection !== undefined) data.collection = dto.collection.trim() || null;
    if (dto.category !== undefined) data.category = await this.taxonomy.requireCategory(dto.category);
    if (dto.occasions !== undefined) data.occasions = await this.taxonomy.requireOccasions(dto.occasions);
    // Going live for the first time stamps the publish date.
    if (dto.status === "PUBLISHED") {
      const current = await this.prisma.brandProduct.findUnique({ where: { id }, select: { publishedAt: true } });
      if (!current?.publishedAt) data.publishedAt = new Date();
    }
    try {
      const updated = await this.prisma.brandProduct.update({ where: { id }, data, include: WITH_COUNTS });
      this.taxonomy.invalidatePublic();
      return toEntity(updated);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Another garment already uses that SKU.');
      }
      throw e;
    }
  }

  async remove(brandId: string, id: string): Promise<{ success: boolean; id: string }> {
    const { count } = await this.prisma.brandProduct.deleteMany({ where: { id, brandId } });
    if (count === 0) throw new NotFoundException(`Garment with ID ${id} not found.`);
    this.taxonomy.invalidatePublic();
    return { success: true, id };
  }

  /** Returns false when the garment isn't this brand's, so callers can ignore foreign ids. */
  async incrementClick(brandId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.brandProduct.updateMany({ where: { id, brandId }, data: { clicksCount: { increment: 1 } } });
    return count > 0;
  }

  /** Total buy clicks and try-ons across this brand's garments. */
  async totals(brandId: string) {
    const sum = await this.prisma.brandProduct.aggregate({ where: { brandId }, _sum: { clicksCount: true, drapesCount: true } });
    return { clicks: sum._sum.clicksCount ?? 0, drapes: sum._sum.drapesCount ?? 0 };
  }

  // ── Shopper-facing ──────────────────────────────────────────────────────

  async listPublic(brandId: string, limit = 200): Promise<PublicProduct[]> {
    const rows = await this.prisma.brandProduct.findMany({
      where: { brandId, status: 'PUBLISHED' },
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      include: WITH_COUNTS,
    });
    return rows.map(toPublicProduct);
  }

  /** A shopper tapped Buy. Counted per garment; returns where to send them. */
  async recordPublicClick(productId: string): Promise<{ buyUrl: string } | null> {
    const row = await this.prisma.brandProduct.findFirst({ where: { id: productId, status: 'PUBLISHED', brand: { isDeleted: false, status: 'ACTIVE' } } });
    // A garment with no store link yet has nowhere to send the shopper.
    if (!row || !row.buyUrl.trim()) return null;
    await this.prisma.brandProduct.update({ where: { id: row.id }, data: { clicksCount: { increment: 1 } } });
    return { buyUrl: row.buyUrl };
  }
}
