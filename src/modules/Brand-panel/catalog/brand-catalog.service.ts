import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { BrandEventsService } from '../../../shared/brand-events/brand-events.service';
import { Prisma } from '@prisma/client';
import { assertPlanRoom } from '../billing/plans';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateGarmentDto, UpdateGarmentDto } from '../dto/brand-common.dto';
import { TaxonomyService } from '../taxonomy/taxonomy.service';
import { BULK_MAX, BulkCatalogDto, CatalogPageQueryDto, CatalogSort, ImportCatalogDto } from './catalog-page.dto';
import { normalizeImportRow, NormalizedRow } from './catalog-import';
import { decodeCursor, encodeCursor, sliceByLimit } from '../../../common/pagination/cursor';
import { LOW_STOCK_AT, normaliseSizeChart, normaliseVariants, rollUp, stockState, type SizeChart, type StockState, type VariantInput } from './catalog-variants';
import { withUtm } from './catalog-utm';
import { photoStatus } from './catalog-ai';
import { CatalogAiService } from './catalog-ai.service';

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
  /** One row per size/colour with its own stock. Empty when the piece is sold as one item. */
  variants: VariantEntity[];
  sizeChart?: SizeChart;
  fitNotes?: string;
  fabric?: string;
  pattern?: string;
  tags: string[];
  seoKeywords: string[];
  /** The try-on photo check: a warning for the brand, never a gate for shoppers. */
  photo: { status: 'missing' | 'unchecked' | 'good' | 'needs_work'; score: number; issues: string[]; checkedAt?: string };
  /** Set when the piece came from a store sync. */
  externalSource?: string;
  syncedAt?: string;
}

export interface VariantEntity {
  id: string;
  size: string;
  color: string;
  colorHex?: string;
  sku?: string;
  price?: number;
  stock: number;
}

/** A brand's showcase is a short, curated list, so only this many pieces can be featured at once. */
export const MAX_FEATURED = 8;

export { LOW_STOCK_AT };

/** Trims, de-duplicates (ignoring case) and caps a list of short labels. */
const cleanList = (values: string[] | undefined, max: number) => {
  const out: string[] = [];
  for (const v of values ?? []) {
    const t = v.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, max);
};

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

export const WITH_COUNTS = {
  _count: { select: { likes: true, comments: true } },
  // Rows are written in the brand's order, so sortOrder alone gives that order back.
  variants: { orderBy: { sortOrder: 'asc' as const } },
} as const;
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
  variants: (r.variants ?? []).map((v) => ({ id: v.id, size: v.size, color: v.color, colorHex: v.colorHex ?? undefined, sku: v.sku ?? undefined, price: v.price ?? undefined, stock: v.stock })),
  sizeChart: (r.sizeChart as unknown as SizeChart | null) ?? undefined,
  fitNotes: r.fitNotes ?? undefined,
  fabric: r.fabric ?? undefined,
  pattern: r.pattern ?? undefined,
  tags: r.tags ?? [],
  seoKeywords: r.seoKeywords ?? [],
  photo: { status: photoStatus({ images: r.images, drapeCheckedAt: r.drapeCheckedAt ?? null, drapeScore: r.drapeScore }), score: r.drapeScore, issues: r.drapeIssues ?? [], checkedAt: r.drapeCheckedAt?.toISOString() },
  externalSource: r.externalSource ?? undefined,
  syncedAt: r.syncedAt?.toISOString(),
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
  collection?: string;
  description?: string;
  likesCount: number;
  sharesCount: number;
  /** Whether the signed-in shopper liked it. Only set where the viewer is known. */
  likedByMe?: boolean;
  /** "low" shows as "Only N left"; the exact count is shared only then. */
  stockState: StockState;
  stockLeft?: number;
  /** Sizes and colours with availability only. Stock counts stay private unless low. */
  variants: { size: string; color: string; colorHex?: string; price?: number; available: boolean; low: boolean }[];
  sizeChart?: SizeChart;
  fitNotes?: string;
  fabric?: string;
  pattern?: string;
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
  collection: r.collection ?? undefined,
  description: r.description ?? undefined,
  likesCount: r._count.likes,
  sharesCount: r.sharesCount,
  stockState: stockState(r.stock),
  ...(stockState(r.stock) === 'low' ? { stockLeft: r.stock } : {}),
  variants: (r.variants ?? []).map((v) => ({
    size: v.size,
    color: v.color,
    colorHex: v.colorHex ?? undefined,
    price: v.price ?? undefined,
    available: v.stock > 0,
    low: stockState(v.stock) === 'low',
  })),
  sizeChart: (r.sizeChart as unknown as SizeChart | null) ?? undefined,
  fitNotes: r.fitNotes ?? undefined,
  fabric: r.fabric ?? undefined,
  pattern: r.pattern ?? undefined,
});

/**
 * Every query is scoped by brandId, so one brand can never read or change another brand's garments.
 */
@Injectable()
export class BrandCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly taxonomy: TaxonomyService,
    @Optional() private readonly events?: BrandEventsService,
    @Optional() private readonly ai?: CatalogAiService,
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
    // Pieces whose photo was checked and fell short, or has not been checked yet.
    if (q.photo === 'needs_work') and.push({ drapeCheckedAt: { not: null }, drapeScore: { lt: 70 } });
    if (q.photo === 'unchecked') and.push({ drapeCheckedAt: null, NOT: { images: { isEmpty: true } } });
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
    const [categories, collections, statuses, outOfStock, lowStock, notReady, featured, total, photoNeedsWork, photoUnchecked] = await Promise.all([
      this.prisma.brandProduct.groupBy({ by: ['category'], where: { brandId }, _count: { _all: true }, orderBy: { _count: { category: 'desc' } } }),
      this.prisma.brandProduct.groupBy({ by: ['collection'], where: { brandId }, _count: { _all: true } }),
      this.prisma.brandProduct.groupBy({ by: ['status'], where: { brandId }, _count: { _all: true } }),
      this.prisma.brandProduct.count({ where: { brandId, stock: { lte: 0 } } }),
      this.prisma.brandProduct.count({ where: { brandId, stock: { gt: 0, lte: LOW_STOCK_AT } } }),
      this.prisma.brandProduct.count({ where: { brandId, isDrapeReady: false } }),
      this.prisma.brandProduct.count({ where: { brandId, featured: true } }),
      this.prisma.brandProduct.count({ where: { brandId } }),
      this.prisma.brandProduct.count({ where: { brandId, drapeCheckedAt: { not: null }, drapeScore: { lt: 70 } } }),
      this.prisma.brandProduct.count({ where: { brandId, drapeCheckedAt: null, NOT: { images: { isEmpty: true } } } }),
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
      photo: { needsWork: photoNeedsWork, unchecked: photoUnchecked },
    };
  }

  /** One action on up to BULK_MAX pieces. Scoped by brandId, so foreign ids are simply not touched. */
  async bulk(brandId: string, dto: BulkCatalogDto) {
    const ids = [...new Set(dto.ids)].slice(0, BULK_MAX);
    const where = { id: { in: ids }, brandId };
    let count = 0;
    if (dto.action === 'delete') {
      count = (await this.prisma.brandProduct.deleteMany({ where })).count;
    } else if (dto.action === 'category') {
      const category = await this.taxonomy.requireCategory(dto.category ?? '');
      count = (await this.prisma.brandProduct.updateMany({ where, data: { category } })).count;
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

  /**
   * Bulk import: up to BULK_MAX rows. Every row is checked on its own, so good rows go in and bad rows come
   * back with a reason. A SKU that already exists is skipped, or updated when updateExisting is set.
   */
  async importItems(brandId: string, dto: ImportCatalogDto) {
    const resolver = await this.taxonomy.resolver();
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId }, select: { websiteUrl: true } });
    const fallbackBuyUrl = brand?.websiteUrl?.trim() ?? '';

    const errors: { row: number; sku?: string; message: string }[] = [];
    const rows: { row: number; data: NormalizedRow }[] = [];
    const seen = new Map<string, number>();
    dto.items.forEach((raw, i) => {
      const row = i + 1;
      try {
        const data = normalizeImportRow(raw, resolver);
        const key = data.sku.toLowerCase();
        const first = seen.get(key);
        if (first !== undefined) throw new Error(`SKU "${data.sku}" is already used in row ${first}.`);
        seen.set(key, row);
        rows.push({ row, data });
      } catch (e) {
        const sku = raw && typeof raw === 'object' ? String((raw as Record<string, unknown>).sku ?? '').trim() || undefined : undefined;
        errors.push({ row, sku, message: e instanceof Error ? e.message : 'This row could not be read.' });
      }
    });

    const existing = rows.length
      ? await this.prisma.brandProduct.findMany({ where: { brandId, sku: { in: rows.map((r) => r.data.sku) } }, select: { id: true, sku: true, publishedAt: true } })
      : [];
    const bySku = new Map(existing.map((e) => [e.sku.toLowerCase(), e]));

    const fresh: Prisma.BrandProductCreateManyInput[] = [];
    const updates: Prisma.PrismaPromise<unknown>[] = [];
    let skipped = 0;
    const now = new Date();
    for (const { data } of rows) {
      const found = bySku.get(data.sku.toLowerCase());
      if (found) {
        if (!dto.updateExisting) {
          skipped++;
          continue;
        }
        const { sku: _sku, status, images, ...rest } = data;
        void _sku;
        const patch: Prisma.BrandProductUpdateInput = { ...rest };
        if (images) {
          patch.images = images;
          patch.isDrapeReady = images.length > 0;
        }
        if (status) {
          patch.status = status;
          if (status === 'PUBLISHED' && !found.publishedAt) patch.publishedAt = now;
        }
        updates.push(this.prisma.brandProduct.update({ where: { id: found.id }, data: patch }));
        continue;
      }
      const status = data.status ?? 'PUBLISHED';
      fresh.push({
        brandId,
        title: data.title,
        sku: data.sku,
        price: data.price,
        originalPrice: data.originalPrice,
        images: data.images ?? [],
        category: data.category,
        occasions: data.occasions ?? [],
        colors: data.colors ?? [],
        sizes: data.sizes ?? [],
        stock: data.stock ?? 0,
        isDrapeReady: (data.images?.length ?? 0) > 0,
        buyUrl: data.buyUrl ?? fallbackBuyUrl,
        newDrop: false,
        collection: data.collection ?? null,
        description: data.description ?? null,
        status,
        publishedAt: status === 'PUBLISHED' ? now : null,
      });
    }

    await assertPlanRoom(this.prisma, brandId, 'garments', fresh.length);
    let created = 0;
    for (let i = 0; i < fresh.length; i += 250) {
      created += (await this.prisma.brandProduct.createMany({ data: fresh.slice(i, i + 250), skipDuplicates: true })).count;
    }
    for (let i = 0; i < updates.length; i += 50) await this.prisma.$transaction(updates.slice(i, i + 50));
    // A row lost to a race on the unique SKU counts as skipped rather than silently vanishing.
    skipped += fresh.length - created;

    if (created || updates.length) this.taxonomy.invalidatePublic();
    return { received: dto.items.length, created, updated: updates.length, skipped, failed: errors.length, errors: errors.slice(0, 200) };
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
    await assertPlanRoom(this.prisma, brandId, 'garments');
    if (dto.featured) await this.assertFeaturedRoom(brandId);
    const category = await this.taxonomy.requireCategory(dto.category);
    const occasions = await this.taxonomy.requireOccasions(dto.occasions ?? []);
    const variants = dto.variants?.length ? normaliseVariants(dto.variants) : [];
    const roll = variants.length ? rollUp(variants) : null;
    const sizeChart = dto.sizeChart !== undefined ? normaliseSizeChart(dto.sizeChart) : null;
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
          colors: roll?.colors ?? dto.colors ?? [],
          sizes: roll?.sizes ?? dto.sizes ?? [],
          stock: roll?.stock ?? dto.stock ?? 0,
          // Worked out here, not taken from the client: "can be tried on" means "has a photo".
          isDrapeReady: (dto.images?.length ?? 0) > 0,
          buyUrl: dto.buyUrl,
          fitNotes: dto.fitNotes?.trim() || null,
          ...(sizeChart ? { sizeChart: sizeChart as unknown as Prisma.InputJsonValue } : {}),
          fabric: dto.fabric?.trim() || null,
          pattern: dto.pattern?.trim() || null,
          tags: cleanList(dto.tags, 12),
          seoKeywords: cleanList(dto.seoKeywords, 10),
          ...(variants.length ? { variants: { create: variants } } : {}),
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
      if (row.images.length) this.ai?.checkInBackground(brandId, row.id);
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
    // Fields with their own handling below are taken out of the pass-through.
    const { variants: variantInput, sizeChart: chartInput, isDrapeReady: _ready, drapeScore: _score, tags, seoKeywords, ...plain } = dto;
    void _ready;
    void _score;
    const data = Object.fromEntries(Object.entries(plain).filter(([, v]) => v !== undefined)) as Prisma.BrandProductUpdateInput;
    if (dto.images !== undefined) data.isDrapeReady = dto.images.length > 0;
    if (dto.fitNotes !== undefined) data.fitNotes = dto.fitNotes.trim() || null;
    if (dto.fabric !== undefined) data.fabric = dto.fabric.trim() || null;
    if (dto.pattern !== undefined) data.pattern = dto.pattern.trim() || null;
    if (tags !== undefined) data.tags = cleanList(tags, 12);
    if (seoKeywords !== undefined) data.seoKeywords = cleanList(seoKeywords, 10);
    if (chartInput !== undefined) data.sizeChart = chartInput === null ? Prisma.DbNull : (normaliseSizeChart(chartInput) as unknown as Prisma.InputJsonValue);
    const variants = variantInput !== undefined ? normaliseVariants(variantInput) : undefined;
    if (variants?.length) Object.assign(data, rollUp(variants));
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
      // The variant table is replaced as a whole, together with the roll-up on the piece.
      const updated = await this.prisma.$transaction(async (tx) => {
        if (variants !== undefined) {
          await tx.brandVariant.deleteMany({ where: { productId: id } });
          if (variants.length) await tx.brandVariant.createMany({ data: variants.map((v) => ({ ...v, productId: id })) });
        }
        return tx.brandProduct.update({ where: { id }, data, include: WITH_COUNTS });
      });
      this.taxonomy.invalidatePublic();
      // A new main photo gets checked again.
      if (dto.images !== undefined && dto.images[0] && dto.images[0] !== current.images[0]) this.ai?.checkInBackground(brandId, id);
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
  async recordPublicClick(productId: string, ref?: string): Promise<{ buyUrl: string } | null> {
    const row = await this.prisma.brandProduct.findFirst({
      where: { id: productId, status: 'PUBLISHED', brand: { isDeleted: false, status: 'ACTIVE' } },
      include: { brand: { select: { slug: true } } },
    });
    // A garment with no store link yet has nowhere to send the shopper.
    if (!row || !row.buyUrl.trim()) return null;
    await this.prisma.brandProduct.update({ where: { id: row.id }, data: { clicksCount: { increment: 1 } } });
    this.events?.record({ brandId: row.brandId, type: 'CLICK', productId: row.id, ...(ref && /^[A-Z2-9]{8}$/.test(ref) ? { ref } : {}) });
    // Tagged so the click-out shows up in the brand's own analytics as coming from ThreadFlank.
    return { buyUrl: withUtm(row.buyUrl, { brandSlug: row.brand.slug, productId: row.id, sku: row.sku, collection: row.collection }) };
  }
}
