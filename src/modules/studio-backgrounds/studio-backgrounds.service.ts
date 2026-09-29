import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { CreateStudioBackgroundDto } from './dto/create-studio-background.dto';
import { UpdateStudioBackgroundDto } from './dto/update-studio-background.dto';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

@Injectable()
export class StudioBackgroundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

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
