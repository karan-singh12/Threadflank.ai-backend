import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBrandStoryDto } from './dto/create-brand-story.dto';
import { BrandStoryFilterDto } from './dto/brand-story-filter.dto';
import { BrandAccessService } from '../brands/brand-access.service';
import { MESSAGES } from '../../common/constants/messages.constant';
import { APP_CONSTANTS } from '../../common/constants/app.constant';
import { buildPaginationMeta } from '../../common/dto/pagination-query.dto';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

@Injectable()
export class BrandStoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandAccess: BrandAccessService,
    private readonly audit: AuditLogService,
  ) {}

  async create(dto: CreateBrandStoryDto, admin: AuthenticatedAdmin) {
    await this.brandAccess.assertAccess(admin, dto.brandId);
    const brand = await this.prisma.brand.findFirst({ where: { id: dto.brandId, isDeleted: false } });
    if (!brand) throw new NotFoundException(MESSAGES.brands.notFound);

    const expiresAt = dto.expiresAt
      ? new Date(dto.expiresAt)
      : new Date(Date.now() + APP_CONSTANTS.brandStories.defaultTtlMs);

    const story = await this.prisma.brandStory.create({
      data: {
        brandId: dto.brandId,
        mediaUrl: dto.mediaUrl,
        mediaType: dto.mediaType,
        caption: dto.caption,
        expiresAt,
        createdByAdminId: admin.adminUserId,
      },
    });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_STORY_CREATED', entityType: 'BrandStory', entityId: story.id });
    return story;
  }

  async findAll(filter: BrandStoryFilterDto, admin: AuthenticatedAdmin) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? APP_CONSTANTS.pagination.adminLimit, APP_CONSTANTS.pagination.maxLimit);
    const skip = (page - 1) * limit;

    const scopedIds = await this.brandAccess.scopedBrandIds(admin);
    const where: any = { isDeleted: false };
    if (scopedIds) where.brandId = { in: scopedIds };
    if (filter.brandId) where.brandId = filter.brandId;

    const [stories, total] = await Promise.all([
      this.prisma.brandStory.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { brand: { select: { id: true, name: true, slug: true, logoUrl: true } } },
      }),
      this.prisma.brandStory.count({ where }),
    ]);

    return { stories, meta: buildPaginationMeta(total, page, limit) };
  }

  /**
   * Active (non-expired) stories, oldest first so a brand's stories play in order; the client
   * groups them by brand. With a signed-in viewer, each says whether they've seen it.
   */
  async findAllPublic(filter: BrandStoryFilterDto, viewerId?: string) {
    const where: any = { isDeleted: false, expiresAt: { gt: new Date() } };
    if (filter.brandId) where.brandId = filter.brandId;

    const rows = await this.prisma.brandStory.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        brand: { select: { id: true, name: true, slug: true, logoUrl: true, isVerified: true } },
        ...(viewerId ? { views: { where: { userId: viewerId }, select: { id: true } } } : {}),
      },
      take: 200,
    });

    const stories = rows.map(({ views, ...story }: any) => ({ ...story, viewed: Boolean(views?.length) }));
    return { stories };
  }

  async findOneActive(id: string) {
    const story = await this.prisma.brandStory.findFirst({
      where: { id, isDeleted: false, expiresAt: { gt: new Date() } },
      include: { brand: true },
    });
    if (!story) throw new NotFoundException(MESSAGES.brandStories.notFound);
    return story;
  }

  /** Counts one view per person. Returns the story's view count. */
  async recordView(id: string, userId: string) {
    const story = await this.findOneActive(id);
    const existing = await this.prisma.brandStoryView.findUnique({ where: { storyId_userId: { storyId: id, userId } } });
    if (existing) return { viewsCount: story.viewsCount };

    try {
      const [, updated] = await this.prisma.$transaction([
        this.prisma.brandStoryView.create({ data: { storyId: id, userId } }),
        this.prisma.brandStory.update({ where: { id }, data: { viewsCount: { increment: 1 } } }),
      ]);
      return { viewsCount: updated.viewsCount };
    } catch {
      // A second tab recorded the same view first.
      return { viewsCount: story.viewsCount };
    }
  }

  async remove(id: string, admin: AuthenticatedAdmin) {
    const story = await this.prisma.brandStory.findFirst({ where: { id, isDeleted: false } });
    if (!story) throw new NotFoundException(MESSAGES.brandStories.notFound);
    await this.brandAccess.assertAccess(admin, story.brandId);

    await this.prisma.brandStory.update({ where: { id }, data: { isDeleted: true } });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_STORY_DELETED', entityType: 'BrandStory', entityId: id });
  }

  /** Called by the cleanup job — purges stories that expired well in the past. */
  async purgeExpired(olderThanMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await this.prisma.brandStory.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    return result.count;
  }
}
