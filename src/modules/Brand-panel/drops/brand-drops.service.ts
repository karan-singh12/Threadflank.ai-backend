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

@Injectable()
export class BrandDropsService {
  private drops: LaunchDropEntity[] = [
    {
      id: 'drop_nov_26',
      title: "Kashi Heritage Wedding Collection '26",
      collectionName: 'The Royal Banaras Chapter',
      description: 'Handwoven brocade and tissue lehengas crafted for the upcoming bridal season.',
      launchDate: new Date(Date.now() + 1000 * 60 * 60 * 36).toISOString(),
      waitlistCount: 2480,
      status: 'scheduled',
      bannerUrl: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1200&auto=format&fit=crop&q=80',
      productsCount: 12,
      skuCount: 24,
      countdownDays: 2,
    },
    {
      id: 'drop_diwali_26',
      title: 'Diwali Sparkle Festive Capsule',
      collectionName: 'Noor Organza',
      description: 'Luminous sheer organza sarees and angrakhas dipped in natural pastels.',
      launchDate: new Date(Date.now() - 1000 * 60 * 60 * 120).toISOString(),
      waitlistCount: 4910,
      status: 'live',
      bannerUrl: 'https://images.unsplash.com/photo-1544441893-675973e31985?w=1200&auto=format&fit=crop&q=80',
      productsCount: 8,
      skuCount: 16,
      countdownDays: 0,
    },
  ];

  findAll(): LaunchDropEntity[] {
    return this.drops;
  }

  create(dto: CreateDropDto): LaunchDropEntity {
    const launchTime = new Date(dto.launchDate).getTime();
    const isLive = launchTime <= Date.now();
    const countdownDays = Math.max(0, Math.ceil((launchTime - Date.now()) / (1000 * 60 * 60 * 24)));

    const newDrop: LaunchDropEntity = {
      id: `drop_${Date.now()}`,
      title: dto.title,
      collectionName: dto.collectionName,
      description: dto.description,
      launchDate: dto.launchDate,
      waitlistCount: 0,
      status: isLive ? 'live' : 'scheduled',
      bannerUrl: dto.bannerUrl,
      productsCount: dto.productsCount || 1,
      skuCount: (dto.productsCount || 1) * 2,
      countdownDays,
    };

    this.drops.unshift(newDrop);
    return newDrop;
  }
}

