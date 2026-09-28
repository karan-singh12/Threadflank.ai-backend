import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { CreateStudioBackgroundDto } from './dto/create-studio-background.dto';
import { UpdateStudioBackgroundDto } from './dto/update-studio-background.dto';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

@Injectable()
export class StudioBackgroundsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async onModuleInit() {
    await this.seedDefaultsIfEmpty();
  }

  /**
   * Seed curated scene backgrounds for Drape Studio if table is empty.
   */
  async seedDefaultsIfEmpty() {
    const count = await this.prisma.studioBackground.count();
    if (count > 0) return;

    const defaults = [
      {
        name: 'Modern Studio',
        category: 'Studio',
        imageUrl: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?auto=format&fit=crop&w=1200&q=80',
        cssGradient: 'radial-gradient(circle at 50% 30%, #2a2548 0%, #0d0c1f 70%)',
        isDefault: true,
        order: 1,
      },
      {
        name: 'Sunlit Terrace',
        category: 'Outdoor',
        imageUrl: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80',
        cssGradient: 'linear-gradient(180deg, #ffb88c 0%, #de6262 55%, #3a1c40 100%)',
        isDefault: false,
        order: 2,
      },
      {
        name: 'Parisian Avenue',
        category: 'Urban',
        imageUrl: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?auto=format&fit=crop&w=1200&q=80',
        cssGradient: 'linear-gradient(180deg, #a3b1c6 0%, #52607a 55%, #1c2230 100%)',
        isDefault: false,
        order: 3,
      },
      {
        name: 'Luxury Penthouse',
        category: 'Luxury',
        imageUrl: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80',
        cssGradient: 'radial-gradient(circle at 50% 20%, #ffd87a 0%, #d2553a 45%, #4a1030 100%)',
        isDefault: false,
        order: 4,
      },
      {
        name: 'Botanical Garden',
        category: 'Nature',
        imageUrl: 'https://images.unsplash.com/photo-1585320806297-9794b3e4eeae?auto=format&fit=crop&w=1200&q=80',
        cssGradient: 'linear-gradient(180deg, #cfe8c0 0%, #6fa66b 55%, #28452a 100%)',
        isDefault: false,
        order: 5,
      },
      {
        name: 'Neon Nightclub',
        category: 'Party',
        imageUrl: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?auto=format&fit=crop&w=1200&q=80',
        cssGradient: 'radial-gradient(circle at 50% 50%, #6645eb 0%, #070614 80%)',
        isDefault: false,
        order: 6,
      },
    ];

    for (const item of defaults) {
      await this.prisma.studioBackground.create({
        data: item,
      });
    }
    console.log('[StudioBackgrounds] Seeded initial character scene backgrounds.');
  }

  /**
   * Public list for User Panel Drape Studio.
   */
  async findAllActive() {
    return this.prisma.studioBackground.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Admin list of all backgrounds.
   */
  async findAllAdmin() {
    return this.prisma.studioBackground.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async findOne(id: string) {
    const bg = await this.prisma.studioBackground.findUnique({ where: { id } });
    if (!bg) {
      throw new NotFoundException(`Studio background ${id} not found`);
    }
    return bg;
  }

  async create(dto: CreateStudioBackgroundDto, admin?: AuthenticatedAdmin) {
    if (dto.isDefault) {
      await this.prisma.studioBackground.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const created = await this.prisma.studioBackground.create({
      data: {
        name: dto.name,
        category: dto.category || 'Studio',
        imageUrl: dto.imageUrl || null,
        cssGradient: dto.cssGradient || null,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
        order: dto.order ?? 0,
        createdByAdminId: admin?.adminUserId || null,
      },
    });

    if (admin) {
      await this.auditLog.log({
        adminUserId: admin.adminUserId,
        action: 'STUDIO_BACKGROUND_CREATED',
        entityType: 'StudioBackground',
        entityId: created.id,
        metadata: { name: created.name },
      });
    }

    return created;
  }

  async update(id: string, dto: UpdateStudioBackgroundDto, admin?: AuthenticatedAdmin) {
    await this.findOne(id);

    if (dto.isDefault) {
      await this.prisma.studioBackground.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    const updated = await this.prisma.studioBackground.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.category !== undefined ? { category: dto.category } : {}),
        ...(dto.imageUrl !== undefined ? { imageUrl: dto.imageUrl } : {}),
        ...(dto.cssGradient !== undefined ? { cssGradient: dto.cssGradient } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.order !== undefined ? { order: dto.order } : {}),
      },
    });

    if (admin) {
      await this.auditLog.log({
        adminUserId: admin.adminUserId,
        action: 'STUDIO_BACKGROUND_UPDATED',
        entityType: 'StudioBackground',
        entityId: id,
        metadata: { changes: dto },
      });
    }

    return updated;
  }

  async remove(id: string, admin?: AuthenticatedAdmin) {
    await this.findOne(id);
    await this.prisma.studioBackground.delete({ where: { id } });

    if (admin) {
      await this.auditLog.log({
        adminUserId: admin.adminUserId,
        action: 'STUDIO_BACKGROUND_DELETED',
        entityType: 'StudioBackground',
        entityId: id,
      });
    }

    return { success: true };
  }
}
