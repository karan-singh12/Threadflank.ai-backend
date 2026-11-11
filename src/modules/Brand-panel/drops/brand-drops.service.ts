import { Injectable } from '@nestjs/common';
import { CreateDropDto } from '../dto/brand-common.dto';

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

  create(brandId: string, dto: CreateDropDto): LaunchDropEntity {
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
}
