import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MESSAGES } from '../../common/constants/messages.constant';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';
import { AdminRole } from '@prisma/client';

/**
 * Shared BRAND_MANAGER scoping check, reused by brands/brand-posts/brand-stories
 * services: SUPER_ADMIN and ADMIN can touch any brand; BRAND_MANAGER only the
 * brands they're explicitly assigned to via BrandManagerAssignment.
 */
@Injectable()
export class BrandAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertAccess(admin: AuthenticatedAdmin, brandId: string): Promise<void> {
    if (admin.role === AdminRole.SUPER_ADMIN || admin.role === AdminRole.ADMIN) return;

    const assignment = await this.prisma.brandManagerAssignment.findUnique({
      where: { adminUserId_brandId: { adminUserId: admin.adminUserId, brandId } },
    });

    if (!assignment) {
      throw new ForbiddenException(MESSAGES.brands.notAssigned);
    }
  }

  /** For list endpoints: returns the brandId filter a BRAND_MANAGER is limited to, or
   * `undefined` for SUPER_ADMIN/ADMIN (no restriction). */
  async scopedBrandIds(admin: AuthenticatedAdmin): Promise<string[] | undefined> {
    if (admin.role === AdminRole.SUPER_ADMIN || admin.role === AdminRole.ADMIN) return undefined;

    const assignments = await this.prisma.brandManagerAssignment.findMany({
      where: { adminUserId: admin.adminUserId },
      select: { brandId: true },
    });
    return assignments.map((a) => a.brandId);
  }
}
