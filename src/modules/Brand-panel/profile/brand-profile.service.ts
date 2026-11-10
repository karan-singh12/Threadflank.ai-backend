import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateBrandProfileDto } from '../dto/brand-common.dto';
import { BrandAuthService } from '../auth/brand-auth.service';

@Injectable()
export class BrandProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: BrandAuthService,
  ) {}

  async getProfile(slug: string = 'raw-mango') {
    return this.authService.validateOrGetBrand(slug);
  }

  async updateProfile(dto: UpdateBrandProfileDto, slug: string = 'raw-mango') {
    const existing = await this.prisma.brand.findUnique({ where: { slug } });
    if (!existing) {
      await this.authService.validateOrGetBrand(slug);
    }

    const currentSocial = ((existing?.socialLinks as any) || {});
    const updatedSocial = {
      ...currentSocial,
      ...(dto.themeAccent !== undefined ? { themeAccent: dto.themeAccent } : {}),
      ...(dto.announcementText !== undefined ? { announcementText: dto.announcementText } : {}),
      ...(dto.physicalStoreAddress !== undefined ? { flagshipAddress: dto.physicalStoreAddress } : {}),
      ...(dto.isOnlineOnly !== undefined ? { isOnlineOnly: dto.isOnlineOnly } : {}),
    };

    const updated = await this.prisma.brand.update({
      where: { slug },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.story ? { description: dto.story } : {}),
        ...(dto.logo ? { logoUrl: dto.logo } : {}),
        ...(dto.websiteUrl ? { websiteUrl: dto.websiteUrl } : {}),
        socialLinks: updatedSocial,
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      logo: updated.logoUrl || 'https://images.unsplash.com/photo-1544441893-675973e31985?w=200&auto=format&fit=crop&q=80',
      banner: dto.banner || 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=1600&auto=format&fit=crop&q=80',
      story: updated.description || '',
      verified: updated.isVerified,
      themeAccent: updatedSocial.themeAccent || '#6342f0',
      announcementText: updatedSocial.announcementText || '',
      websiteUrl: updated.websiteUrl || '',
      physicalStoreAddress: updatedSocial.flagshipAddress || '',
      isOnlineOnly: updatedSocial.isOnlineOnly ?? false,
      followersCount: 14850,
      aiCredits: updatedSocial.aiCredits ?? 420,
      currentRank: 6,
      totalBrands: 240,
      rankScore: updatedSocial.rankScore ?? 8450,
      widgetKey: updated.widgetKey,
      widgetEnabled: updated.widgetEnabled,
    };
  }
}

