import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateBrandPostDto } from './dto/create-brand-post.dto';
import { UpdateBrandPostDto } from './dto/update-brand-post.dto';
import { BrandPostFilterDto } from './dto/brand-post-filter.dto';
import { BrandAccessService } from '../brands/brand-access.service';
import { MESSAGES } from '../../common/constants/messages.constant';
import { APP_CONSTANTS } from '../../common/constants/app.constant';
import { buildPaginationMeta } from '../../common/dto/pagination-query.dto';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { SdkService } from '../../sdk';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';
import { ContentStatus } from '@prisma/client';

@Injectable()
export class BrandPostsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandAccess: BrandAccessService,
    private readonly audit: AuditLogService,
    private readonly sdk: SdkService,
  ) {}

  async create(dto: CreateBrandPostDto, admin: AuthenticatedAdmin) {
    await this.brandAccess.assertAccess(admin, dto.brandId);
    const brand = await this.prisma.brand.findFirst({ where: { id: dto.brandId, isDeleted: false } });
    if (!brand) throw new NotFoundException(MESSAGES.brands.notFound);

    const status: ContentStatus = dto.scheduledAt ? ContentStatus.SCHEDULED : ContentStatus.DRAFT;

    const post = await this.prisma.brandPost.create({
      data: {
        brandId: dto.brandId,
        title: dto.title,
        caption: dto.caption,
        images: dto.images as any,
        category: dto.category,
        taggedProducts: dto.taggedProducts as any,
        status,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        createdByAdminId: admin.adminUserId,
      },
    });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_POST_CREATED', entityType: 'BrandPost', entityId: post.id });
    return post;
  }

  async findAll(filter: BrandPostFilterDto, admin: AuthenticatedAdmin) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? APP_CONSTANTS.pagination.adminLimit, APP_CONSTANTS.pagination.maxLimit);
    const skip = (page - 1) * limit;

    const scopedIds = await this.brandAccess.scopedBrandIds(admin);

    const where: any = { isDeleted: false };
    if (scopedIds) where.brandId = { in: scopedIds };
    if (filter.brandId) where.brandId = filter.brandId;
    if (filter.status) where.status = filter.status;
    if (filter.category) where.category = filter.category;

    const [posts, total] = await Promise.all([
      this.prisma.brandPost.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { brand: { select: { id: true, name: true, slug: true, logoUrl: true } } },
      }),
      this.prisma.brandPost.count({ where }),
    ]);

    return { posts, meta: buildPaginationMeta(total, page, limit) };
  }

  async findAllPublic(filter: BrandPostFilterDto, userId?: string) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? APP_CONSTANTS.pagination.defaultLimit, APP_CONSTANTS.pagination.maxLimit);
    const skip = (page - 1) * limit;

    const where: any = { isDeleted: false, status: ContentStatus.PUBLISHED };
    if (filter.brandId) where.brandId = filter.brandId;
    if (filter.category) where.category = filter.category;

    const [posts, total] = await Promise.all([
      this.prisma.brandPost.findMany({
        where,
        skip,
        take: limit,
        orderBy: { publishedAt: 'desc' },
        include: {
          brand: { select: { id: true, name: true, slug: true, logoUrl: true, isVerified: true } },
          _count: { select: { likes: true, comments: true } },
          variants: { orderBy: [{ productName: 'asc' }, { createdAt: 'asc' }] },
        },
      }),
      this.prisma.brandPost.count({ where }),
    ]);

    let likedPostIds = new Set<string>();
    if (userId && posts.length > 0) {
      const likes = await this.prisma.brandPostLike.findMany({
        where: { userId, postId: { in: posts.map((p) => p.id) } },
        select: { postId: true },
      });
      likedPostIds = new Set(likes.map((l) => l.postId));
    }

    const postsWithEngagement = posts.map((post) => ({
      ...post,
      likesCount: post._count.likes,
      commentsCount: post._count.comments,
      likedByMe: likedPostIds.has(post.id),
    }));

    return { posts: postsWithEngagement, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const post = await this.prisma.brandPost.findFirst({ where: { id, isDeleted: false }, include: { brand: true, variants: true } });
    if (!post) throw new NotFoundException(MESSAGES.brandPosts.notFound);
    return post;
  }

  async update(id: string, dto: UpdateBrandPostDto, admin: AuthenticatedAdmin) {
    const post = await this.findOne(id);
    await this.brandAccess.assertAccess(admin, post.brandId);

    const updated = await this.prisma.brandPost.update({
      where: { id },
      data: {
        title: dto.title,
        caption: dto.caption,
        images: dto.images as any,
        category: dto.category,
        taggedProducts: dto.taggedProducts as any,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
      },
    });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_POST_UPDATED', entityType: 'BrandPost', entityId: id });
    return updated;
  }

  async schedule(id: string, scheduledAt: string, admin: AuthenticatedAdmin) {
    const post = await this.findOne(id);
    await this.brandAccess.assertAccess(admin, post.brandId);

    if (post.status !== ContentStatus.DRAFT) {
      throw new BadRequestException(MESSAGES.brandPosts.invalidTransition(post.status, ContentStatus.SCHEDULED));
    }

    const updated = await this.prisma.brandPost.update({
      where: { id },
      data: { status: ContentStatus.SCHEDULED, scheduledAt: new Date(scheduledAt) },
    });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_POST_SCHEDULED', entityType: 'BrandPost', entityId: id });
    return updated;
  }

  async publish(id: string, admin: AuthenticatedAdmin) {
    const post = await this.findOne(id);
    await this.brandAccess.assertAccess(admin, post.brandId);

    if (post.status === ContentStatus.PUBLISHED) {
      throw new BadRequestException(MESSAGES.brandPosts.invalidTransition(post.status, ContentStatus.PUBLISHED));
    }

    const updated = await this.prisma.brandPost.update({
      where: { id },
      data: { status: ContentStatus.PUBLISHED, publishedAt: new Date(), failureReason: null },
    });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_POST_PUBLISHED', entityType: 'BrandPost', entityId: id });
    return updated;
  }

  async remove(id: string, admin: AuthenticatedAdmin) {
    const post = await this.findOne(id);
    await this.brandAccess.assertAccess(admin, post.brandId);

    await this.prisma.brandPost.update({ where: { id }, data: { isDeleted: true } });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_POST_DELETED', entityType: 'BrandPost', entityId: id });
  }

  async generateCaption(id: string, admin: AuthenticatedAdmin) {
    const post = await this.findOne(id);
    await this.brandAccess.assertAccess(admin, post.brandId);

    const caption = await this.sdk.generateCaption(
      { itemName: post.title || post.brand.name, brand: post.brand.name, category: post.category ?? undefined },
      { requestedBy: admin.adminUserId },
    );

    const updated = await this.prisma.brandPost.update({ where: { id }, data: { caption } });

    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_POST_CAPTION_GENERATED', entityType: 'BrandPost', entityId: id });
    return updated;
  }

  // ─── End-user engagement (Discover feed likes/comments, PRD §4.5) ─────────

  async toggleLike(postId: string, userId: string) {
    await this.findOne(postId);
    const existing = await this.prisma.brandPostLike.findUnique({ where: { postId_userId: { postId, userId } } });

    if (existing) {
      await this.prisma.brandPostLike.delete({ where: { postId_userId: { postId, userId } } });
      return { liked: false };
    }

    await this.prisma.brandPostLike.create({ data: { postId, userId } });
    return { liked: true };
  }

  async addComment(postId: string, userId: string, content: string) {
    await this.findOne(postId);
    return this.prisma.brandPostComment.create({ data: { postId, userId, content } });
  }

  async listComments(postId: string) {
    await this.findOne(postId);
    return this.prisma.brandPostComment.findMany({ where: { postId }, orderBy: { createdAt: 'asc' } });
  }

  /** Called by the scheduler job — not admin-scoped, runs as the system. */
  async publishDueScheduledPosts(): Promise<number> {
    const due = await this.prisma.brandPost.findMany({
      where: { status: ContentStatus.SCHEDULED, scheduledAt: { lte: new Date() }, isDeleted: false },
      select: { id: true },
    });

    if (due.length === 0) return 0;

    await this.prisma.brandPost.updateMany({
      where: { id: { in: due.map((p) => p.id) } },
      data: { status: ContentStatus.PUBLISHED, publishedAt: new Date() },
    });

    return due.length;
  }
}
