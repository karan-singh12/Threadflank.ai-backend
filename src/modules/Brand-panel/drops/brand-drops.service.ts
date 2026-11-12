import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateDropDto, UpdateDropDto } from '../dto/brand-common.dto';

export interface LaunchDropEntity {
  id: string;
  title: string;
  collectionName: string;
  description?: string;
  launchDate: string;
  waitlistCount: number;
  status: 'scheduled' | 'live' | 'completed';
  bannerUrl: string;
  productsCount: number;
  skuCount?: number;
  countdownDays?: number;
}

/** Per-brand, in-memory drops (reset on restart) until a BrandDrop table exists. */
@Injectable()
export class BrandDropsService {
  private readonly byBrand = new Map<string, LaunchDropEntity[]>();

  private withStatus(drop: LaunchDropEntity): LaunchDropEntity {
    const msLeft = new Date(drop.launchDate).getTime() - Date.now();
    return { ...drop, status: msLeft <= 0 ? 'live' : 'scheduled', countdownDays: Math.max(0, Math.ceil(msLeft / 86_400_000)) };
  }

  findAll(brandId: string): LaunchDropEntity[] {
    return (this.byBrand.get(brandId) ?? []).map((d) => this.withStatus(d));
  }

  /** Today is fine (the date picker sends midnight); earlier days are not. */
  private assertNotPast(launchDate: string) {
    if (new Date(launchDate).getTime() < Date.now() - 86_400_000) {
      throw new BadRequestException('Launch date cannot be in the past.');
    }
  }

  create(brandId: string, dto: CreateDropDto): LaunchDropEntity {
    this.assertNotPast(dto.launchDate);
    const drop: LaunchDropEntity = {
      id: `drop_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      title: dto.title,
      collectionName: dto.collectionName,
      description: dto.description,
      launchDate: dto.launchDate,
      waitlistCount: 0,
      status: 'scheduled',
      bannerUrl: dto.bannerUrl,
      productsCount: dto.productsCount || 1,
    };
    this.byBrand.set(brandId, [drop, ...(this.byBrand.get(brandId) ?? [])]);
    return this.withStatus(drop);
  }

  update(brandId: string, id: string, dto: UpdateDropDto): LaunchDropEntity {
    const drop = (this.byBrand.get(brandId) ?? []).find((d) => d.id === id);
    if (!drop) throw new NotFoundException('Drop not found.');
    if (dto.launchDate !== undefined) this.assertNotPast(dto.launchDate);
    for (const [k, v] of Object.entries(dto)) if (v !== undefined) (drop as any)[k] = v;
    return this.withStatus(drop);
  }

  remove(brandId: string, id: string) {
    const list = this.byBrand.get(brandId) ?? [];
    if (!list.some((d) => d.id === id)) throw new NotFoundException('Drop not found.');
    this.byBrand.set(brandId, list.filter((d) => d.id !== id));
    return { success: true, id };
  }
}
