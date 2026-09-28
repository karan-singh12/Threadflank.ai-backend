import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBrandDto } from './dto/create-brand.dto';
import { UpdateBrandDto } from './dto/update-brand.dto';
import { BrandFilterDto } from './dto/brand-filter.dto';
import { BrandAccessService } from './brand-access.service';
import { MESSAGES } from '../../common/constants/messages.constant';
import { APP_CONSTANTS } from '../../common/constants/app.constant';
import { buildPaginationMeta } from '../../common/dto/pagination-query.dto';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';
import { BrandStatus } from '@prisma/client';

@Injectable()
export class BrandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandAccess: BrandAccessService,
    private readonly audit: AuditLogService,
  ) {}

  async create(dto: CreateBrandDto, admin: AuthenticatedAdmin) {
    const existing = await this.prisma.brand.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new BadRequestException(MESSAGES.brands.slugTaken);

    const brand = await this.prisma.brand.create({
      data: { ...dto, createdByAdminId: admin.adminUserId },
    });

    await this.audit.log({
      adminUserId: admin.adminUserId,
      action: 'BRAND_CREATED',
      entityType: 'Brand',
      entityId: brand.id,
    });

    return brand;
  }

  async findAll(filter: BrandFilterDto, admin: AuthenticatedAdmin) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? APP_CONSTANTS.pagination.adminLimit, APP_CONSTANTS.pagination.maxLimit);
    const skip = (page - 1) * limit;

    const scopedIds = await this.brandAccess.scopedBrandIds(admin);

    const where: any = { isDeleted: false };
    if (scopedIds) where.id = { in: scopedIds };
    if (filter.status) where.status = filter.status;
    if (filter.category) where.category = filter.category;
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { slug: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    const [brands, total] = await Promise.all([
      this.prisma.brand.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.brand.count({ where }),
    ]);

    return { brands, meta: buildPaginationMeta(total, page, limit) };
  }

  async findAllPublic(filter: BrandFilterDto) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? APP_CONSTANTS.pagination.defaultLimit, APP_CONSTANTS.pagination.maxLimit);
    const skip = (page - 1) * limit;

    const where: any = { isDeleted: false, status: BrandStatus.ACTIVE };
    if (filter.category) where.category = filter.category;
    if (filter.search) where.name = { contains: filter.search, mode: 'insensitive' };

    const [brands, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true, logoUrl: true, description: true, category: true, isVerified: true, socialLinks: true },
      }),
      this.prisma.brand.count({ where }),
    ]);

    return { brands, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const brand = await this.prisma.brand.findFirst({ where: { id, isDeleted: false } });
    if (!brand) throw new NotFoundException(MESSAGES.brands.notFound);
    return brand;
  }

  async update(id: string, dto: UpdateBrandDto, admin: AuthenticatedAdmin) {
    await this.brandAccess.assertAccess(admin, id);
    const brand = await this.findOne(id);

    const updated = await this.prisma.brand.update({ where: { id: brand.id }, data: dto });

    await this.audit.log({
      adminUserId: admin.adminUserId,
      action: 'BRAND_UPDATED',
      entityType: 'Brand',
      entityId: id,
      metadata: dto as Record<string, unknown>,
    });

    return updated;
  }

  async remove(id: string, admin: AuthenticatedAdmin) {
    await this.brandAccess.assertAccess(admin, id);
    const brand = await this.findOne(id);

    await this.prisma.brand.update({ where: { id: brand.id }, data: { isDeleted: true } });

    await this.audit.log({
      adminUserId: admin.adminUserId,
      action: 'BRAND_DELETED',
      entityType: 'Brand',
      entityId: id,
    });
  }

  async assignManager(brandId: string, targetAdminUserId: string, admin: AuthenticatedAdmin) {
    await this.findOne(brandId);
    const targetAdmin = await this.prisma.adminUser.findUnique({ where: { id: targetAdminUserId } });
    if (!targetAdmin) throw new NotFoundException('Admin user not found');

    const assignment = await this.prisma.brandManagerAssignment.upsert({
      where: { adminUserId_brandId: { adminUserId: targetAdminUserId, brandId } },
      update: {},
      create: { adminUserId: targetAdminUserId, brandId },
    });

    await this.audit.log({
      adminUserId: admin.adminUserId,
      action: 'BRAND_MANAGER_ASSIGNED',
      entityType: 'Brand',
      entityId: brandId,
      metadata: { assignedAdminUserId: targetAdminUserId },
    });

    return assignment;
  }

  async unassignManager(brandId: string, targetAdminUserId: string, admin: AuthenticatedAdmin) {
    await this.prisma.brandManagerAssignment.deleteMany({
      where: { brandId, adminUserId: targetAdminUserId },
    });

    await this.audit.log({
      adminUserId: admin.adminUserId,
      action: 'BRAND_MANAGER_UNASSIGNED',
      entityType: 'Brand',
      entityId: brandId,
      metadata: { unassignedAdminUserId: targetAdminUserId },
    });
  }

  async listManagers(brandId: string) {
    await this.findOne(brandId);
    return this.prisma.brandManagerAssignment.findMany({
      where: { brandId },
      include: { adminUser: { select: { id: true, name: true, email: true, role: true } } },
    });
  }
}
