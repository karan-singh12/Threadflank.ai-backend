import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateBrandProfileDto } from '../dto/brand-common.dto';
import { BrandAuthService } from '../auth/brand-auth.service';

@Injectable()
export class BrandProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: BrandAuthService,
  ) {}

  getProfile(brandId: string) {
    return this.authService.getProfile(brandId);
  }

  async updateProfile(brandId: string, dto: UpdateBrandProfileDto) {
    const existing = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (!existing || existing.isDeleted) throw new NotFoundException('Brand not found.');

    const social = ((existing.socialLinks as Record<string, any> | null) ?? {});
    const updatedSocial = {
      ...social,
      ...(dto.themeAccent !== undefined ? { themeAccent: dto.themeAccent } : {}),
      ...(dto.announcementText !== undefined ? { announcementText: dto.announcementText } : {}),
      ...(dto.banner !== undefined ? { banner: dto.banner } : {}),
      ...(dto.physicalStoreAddress !== undefined ? { flagshipAddress: dto.physicalStoreAddress } : {}),
      ...(dto.isOnlineOnly !== undefined ? { isOnlineOnly: dto.isOnlineOnly } : {}),
    };

    const updated = await this.prisma.brand.update({
      where: { id: brandId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.story !== undefined ? { description: dto.story } : {}),
        ...(dto.logo !== undefined ? { logoUrl: dto.logo } : {}),
        ...(dto.websiteUrl !== undefined ? { websiteUrl: dto.websiteUrl } : {}),
        socialLinks: updatedSocial as Prisma.InputJsonValue,
      },
    });
    return this.authService.toProfile(updated);
  }
}
