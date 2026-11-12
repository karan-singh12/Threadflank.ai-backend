import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { CreateGarmentDto, UpdateGarmentDto } from '../dto/brand-common.dto';

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
}

type Row = Prisma.BrandProductGetPayload<object>;

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
  featured: boolean;
  newDrop: boolean;
}

const toPublic = (r: Row): PublicProduct => ({
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
  featured: r.featured,
  newDrop: r.newDrop,
});

/**
 * Every query is scoped by brandId, so one brand can never read or change another brand's garments.
 */
@Injectable()
export class BrandCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(brandId: string): Promise<ProductItemEntity[]> {
    const rows = await this.prisma.brandProduct.findMany({ where: { brandId }, orderBy: { createdAt: 'desc' } });
    return rows.map(toEntity);
  }

  count(brandId: string) {
    return this.prisma.brandProduct.count({ where: { brandId } });
  }

  async findOne(brandId: string, id: string): Promise<ProductItemEntity> {
    const row = await this.prisma.brandProduct.findFirst({ where: { id, brandId } });
    if (!row) throw new NotFoundException(`Garment with ID ${id} not found in catalog.`);
    return toEntity(row);
  }

  async create(brandId: string, dto: CreateGarmentDto): Promise<ProductItemEntity> {
    try {
      const row = await this.prisma.brandProduct.create({
        data: {
          brandId,
          title: dto.title,
          sku: dto.sku,
          price: dto.price,
          originalPrice: dto.originalPrice,
          images: dto.images ?? [],
          category: dto.category,
          occasions: dto.occasions ?? [],
          colors: dto.colors ?? [],
          sizes: dto.sizes ?? [],
          stock: dto.stock ?? 0,
          isDrapeReady: dto.isDrapeReady ?? false,
          drapeScore: dto.drapeScore ?? 0,
          buyUrl: dto.buyUrl,
          featured: dto.featured ?? false,
          newDrop: dto.newDrop ?? true,
        },
      });
      return toEntity(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(`You already have a garment with SKU ${dto.sku}.`);
      }
      throw e;
    }
  }

  async update(brandId: string, id: string, dto: UpdateGarmentDto): Promise<ProductItemEntity> {
    await this.findOne(brandId, id);
    const data = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Prisma.BrandProductUpdateInput;
    try {
      return toEntity(await this.prisma.brandProduct.update({ where: { id }, data }));
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
      where: { brandId },
      orderBy: [{ featured: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    return rows.map(toPublic);
  }

  /** A shopper tapped Buy. Counted per garment; returns where to send them. */
  async recordPublicClick(productId: string): Promise<{ buyUrl: string } | null> {
    const row = await this.prisma.brandProduct.findFirst({ where: { id: productId, brand: { isDeleted: false, status: 'ACTIVE' } } });
    if (!row) return null;
    await this.prisma.brandProduct.update({ where: { id: row.id }, data: { clicksCount: { increment: 1 } } });
    return { buyUrl: row.buyUrl };
  }
}
