import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BrandCatalogService } from '../../Brand-panel/catalog/brand-catalog.service';
import { BrandDropsService } from '../../Brand-panel/drops/brand-drops.service';
import { BrandBiddingService } from '../../Brand-panel/bidding/brand-bidding.service';
import { PUBLIC_BRAND_SELECT, toPublicBrand } from '../../Admin-panel/brands/public-brand';

@Injectable()
export class BrandShowcaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogSvc: BrandCatalogService,
    private readonly dropsSvc: BrandDropsService,
    private readonly biddingSvc: BrandBiddingService,
  ) {}

  /** Only approved, live brands are visible to shoppers; anything else looks like it does not exist. */
  private async activeBrand(slug: string) {
    const brand = await this.prisma.brand.findFirst({ where: { slug, isDeleted: false, status: 'ACTIVE' }, select: PUBLIC_BRAND_SELECT });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  /** Every approved brand with a preview of its catalog and its upcoming drops, in one call for the Brands page. */
  async all(userId?: string) {
    const brands = await this.prisma.brand.findMany({
      where: { isDeleted: false, status: 'ACTIVE' },
      select: PUBLIC_BRAND_SELECT,
      orderBy: { name: 'asc' },
      take: 40,
    });
    return Promise.all(
      brands.map(async (brand) => ({
        brand: toPublicBrand(brand),
        products: await this.catalogSvc.listPublic(brand.id, 12),
        drops: await this.dropsSvc.listPublic(brand.id, userId),
      })),
    );
  }

  async catalog(slug: string) {
    const brand = await this.activeBrand(slug);
    return { brand: toPublicBrand(brand), products: await this.catalogSvc.listPublic(brand.id) };
  }

  async drops(slug: string, userId?: string) {
    const brand = await this.activeBrand(slug);
    return this.dropsSvc.listPublic(brand.id, userId);
  }

  joinWaitlist(dropId: string, userId: string) {
    return this.dropsSvc.joinWaitlist(dropId, userId);
  }

  leaveWaitlist(dropId: string, userId: string) {
    return this.dropsSvc.leaveWaitlist(dropId, userId);
  }

  click(productId: string) {
    return this.catalogSvc.recordPublicClick(productId);
  }

  spotlight() {
    return this.biddingSvc.spotlight();
  }
}
