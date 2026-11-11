import { Injectable, NotFoundException } from '@nestjs/common';
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

/**
 * Per-brand, in-memory catalog (resets on restart) until a BrandProduct table exists.
 * Keyed by brandId so one brand can never read or change another brand's garments.
 */
@Injectable()
export class BrandCatalogService {
  private readonly byBrand = new Map<string, ProductItemEntity[]>();

  private list(brandId: string): ProductItemEntity[] {
    let items = this.byBrand.get(brandId);
    if (!items) {
      items = [];
      this.byBrand.set(brandId, items);
    }
    return items;
  }

  async findAll(brandId: string): Promise<ProductItemEntity[]> {
    return [...this.list(brandId)];
  }

  async findOne(brandId: string, id: string): Promise<ProductItemEntity> {
    const item = this.list(brandId).find((p) => p.id === id);
    if (!item) throw new NotFoundException(`Garment with ID ${id} not found in catalog.`);
    return item;
  }

  async create(brandId: string, dto: CreateGarmentDto): Promise<ProductItemEntity> {
    const garment: ProductItemEntity = {
      id: `prod_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
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
      drapesCount: 0,
      clicksCount: 0,
      buyUrl: dto.buyUrl,
      featured: dto.featured ?? false,
      newDrop: dto.newDrop ?? true,
    };
    this.list(brandId).unshift(garment);
    return garment;
  }

  async update(brandId: string, id: string, dto: UpdateGarmentDto): Promise<ProductItemEntity> {
    const items = this.list(brandId);
    const index = items.findIndex((p) => p.id === id);
    if (index === -1) throw new NotFoundException(`Garment with ID ${id} not found.`);

    const defined = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    items[index] = { ...items[index], ...defined };
    return items[index];
  }

  async remove(brandId: string, id: string): Promise<{ success: boolean; id: string }> {
    const items = this.list(brandId);
    const index = items.findIndex((p) => p.id === id);
    if (index === -1) throw new NotFoundException(`Garment with ID ${id} not found.`);
    items.splice(index, 1);
    return { success: true, id };
  }

  /** Returns false when the garment isn't this brand's, so callers can ignore foreign ids. */
  incrementClick(brandId: string, id: string): boolean {
    const garment = this.list(brandId).find((p) => p.id === id);
    if (garment) garment.clicksCount += 1;
    return Boolean(garment);
  }

  /** Total buy clicks and try-ons across this brand's garments. */
  totals(brandId: string) {
    return this.list(brandId).reduce(
      (t, p) => ({ clicks: t.clicks + p.clicksCount, drapes: t.drapes + p.drapesCount }),
      { clicks: 0, drapes: 0 },
    );
  }
}
