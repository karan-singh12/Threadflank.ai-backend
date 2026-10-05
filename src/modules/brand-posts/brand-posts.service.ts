import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
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
import { ContentStatus, Prisma } from '@prisma/client';

type CommentRow = { id: string; postId: string; userId: string; content: string; createdAt: Date };
type CommentAuthor = { id: string; username: string; avatar: string | null };

/** What the app feed needs per post: brand, counts, stock variants and the two newest comments. */
const PUBLIC_POST_INCLUDE = {
  brand: { select: { id: true, name: true, slug: true, logoUrl: true, isVerified: true } },
  _count: { select: { likes: true, comments: true } },
  variants: { orderBy: [{ productName: 'asc' as const }, { createdAt: 'asc' as const }] },
  comments: { take: 2, orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.BrandPostInclude;

const firstImage = (images: unknown) => (Array.isArray(images) && typeof images[0] === 'string' ? (images[0] as string) : null);

const withAuthor = (c: CommentRow, authors: Map<string, CommentAuthor>) => ({
  id: c.id,
  postId: c.postId,
  userId: c.userId,
  content: c.content,
  createdAt: c.createdAt,
  user: authors.get(c.userId) ?? { id: c.userId, username: 'member', avatar: null },
});

/** A saved look needs an occasion; map the post's feed category onto the look occasions. */
function occasionFor(category?: string | null) {
  const c = (category ?? '').toLowerCase();
  if (c.includes('formal')) return 'formal';
  if (c.includes('ethnic')) return 'festive';
  return 'casual';
}

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

    const [rows, total] = await Promise.all([
      this.prisma.brandPost.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          brand: { select: { id: true, name: true, slug: true, logoUrl: true } },
          _count: { select: { likes: true, comments: true } },
        },
      }),
      this.prisma.brandPost.count({ where }),
    ]);

    // Saves are Saved looks made from the post's image (see toggleSave).
    const images = rows.map((p) => firstImage(p.images)).filter((i): i is string => Boolean(i));
    const saves = images.length
      ? await this.prisma.look.groupBy({ by: ['image'], where: { image: { in: images } }, _count: { _all: true } })
      : [];
    const savesByImage = new Map(saves.map((s) => [s.image, s._count._all]));
    const posts = rows.map(({ _count, ...post }) => ({
      ...post,
      engagement: {
        likes: _count.likes,
        comments: _count.comments,
        saves: savesByImage.get(firstImage(post.images) ?? '') ?? 0,
        shares: post.sharesCount,
      },
    }));

    return { posts, meta: buildPaginationMeta(total, page, limit) };
  }

  /** Counts a share from the app. */
  async recordShare(postId: string) {
    await this.findPublished(postId);
    const post = await this.prisma.brandPost.update({ where: { id: postId }, data: { sharesCount: { increment: 1 } }, select: { sharesCount: true } });
    return { sharesCount: post.sharesCount };
  }

  /** Comments on a post for moderation, newest first, with each author's email. */
  async adminListComments(postId: string, admin: AuthenticatedAdmin, page = 1, limit = 50) {
    const post = await this.findOne(postId);
    await this.brandAccess.assertAccess(admin, post.brandId);
    const take = Math.min(limit, 100);
    const [comments, total] = await Promise.all([
      this.prisma.brandPostComment.findMany({ where: { postId }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * take, take }),
      this.prisma.brandPostComment.count({ where: { postId } }),
    ]);
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(comments.map((c) => c.userId))] } },
      select: { id: true, username: true, email: true, avatar: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));
    return { comments: comments.map((c) => ({ ...c, user: byId.get(c.userId) ?? null })), meta: buildPaginationMeta(total, page, take) };
  }

  /** Removes any comment on a post the admin can manage. */
  async adminDeleteComment(postId: string, commentId: string, admin: AuthenticatedAdmin) {
    const post = await this.findOne(postId);
    await this.brandAccess.assertAccess(admin, post.brandId);
    const comment = await this.prisma.brandPostComment.findFirst({ where: { id: commentId, postId } });
    if (!comment) throw new NotFoundException('Comment not found');
    await this.prisma.brandPostComment.delete({ where: { id: commentId } });
    await this.audit.log({
      adminUserId: admin.adminUserId,
      action: 'BRAND_POST_COMMENT_DELETED',
      entityType: 'BrandPostComment',
      entityId: commentId,
      metadata: { postId, userId: comment.userId, content: comment.content.slice(0, 200) },
    });
    return { deleted: true, commentsCount: await this.prisma.brandPostComment.count({ where: { postId } }) };
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
        include: PUBLIC_POST_INCLUDE,
      }),
      this.prisma.brandPost.count({ where }),
    ]);

    const engagement = await this.engagementFor(posts, userId);
    const postsWithEngagement = posts.map(({ comments: _comments, _count, ...post }) => ({
      ...post,
      likesCount: _count.likes,
      commentsCount: _count.comments,
      ...engagement(post.id),
    }));

    return { posts: postsWithEngagement, meta: buildPaginationMeta(total, page, limit) };
  }

  /** One published post in the same shape as the feed, for the public post page and share links. */
  async findOnePublic(id: string, userId?: string) {
    const found = await this.prisma.brandPost.findFirst({
      where: { id, isDeleted: false, status: ContentStatus.PUBLISHED },
      include: PUBLIC_POST_INCLUDE,
    });
    if (!found) throw new NotFoundException(MESSAGES.brandPosts.notFound);
    const engagement = await this.engagementFor([found], userId);
    const { comments: _comments, _count, ...post } = found;
    return { ...post, likesCount: _count.likes, commentsCount: _count.comments, ...engagement(post.id) };
  }

  /**
   * Per-post engagement for the viewer: whether they liked or saved it, and the two
   * newest comments as a preview (the feed shows them under each post).
   */
  private async engagementFor(posts: { id: string; images: unknown; comments: CommentRow[] }[], userId?: string) {
    const ids = posts.map((p) => p.id);
    const images = posts.map((p) => firstImage(p.images)).filter((i): i is string => Boolean(i));

    const [likes, saves, authors] = await Promise.all([
      userId && ids.length
        ? this.prisma.brandPostLike.findMany({ where: { userId, postId: { in: ids } }, select: { postId: true } })
        : [],
      userId && images.length
        ? this.prisma.look.findMany({ where: { userId, image: { in: images } }, select: { image: true } })
        : [],
      this.authorsById(posts.flatMap((p) => p.comments.map((c) => c.userId))),
    ]);

    const liked = new Set(likes.map((l) => l.postId));
    const saved = new Set(saves.map((s) => s.image));
    const byId = new Map(posts.map((p) => [p.id, p]));
    return (postId: string) => {
      const post = byId.get(postId);
      return {
        likedByMe: liked.has(postId),
        savedByMe: saved.has(firstImage(post?.images) ?? ''),
        // Fetched newest-first; shown oldest-first like a thread.
        latestComments: (post?.comments ?? []).map((c) => withAuthor(c, authors)).reverse(),
      };
    };
  }

  /** Public author fields only: comments are visible to everyone, so emails are never exposed. */
  private async authorsById(userIds: string[]): Promise<Map<string, CommentAuthor>> {
    if (userIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(userIds)] } },
      select: { id: true, username: true, email: true, avatar: true },
    });
    return new Map(
      users.map((u) => [u.id, { id: u.id, username: u.username || `${u.email.split('@')[0].slice(0, 2)}•••`, avatar: u.avatar }]),
    );
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

  /** Engagement only applies to posts users can actually see. */
  private async findPublished(id: string) {
    const post = await this.prisma.brandPost.findFirst({
      where: { id, isDeleted: false, status: ContentStatus.PUBLISHED },
      select: { id: true, title: true, caption: true, images: true, category: true, taggedProducts: true, brand: { select: { name: true } } },
    });
    if (!post) throw new NotFoundException(MESSAGES.brandPosts.notFound);
    return post;
  }

  async toggleLike(postId: string, userId: string) {
    await this.findPublished(postId);
    const existing = await this.prisma.brandPostLike.findUnique({ where: { postId_userId: { postId, userId } } });

    if (existing) {
      await this.prisma.brandPostLike.delete({ where: { postId_userId: { postId, userId } } });
    } else {
      // A double tap can race two creates; the unique (postId, userId) index makes the second a no-op.
      await this.prisma.brandPostLike.createMany({ data: [{ postId, userId }], skipDuplicates: true });
    }
    const likesCount = await this.prisma.brandPostLike.count({ where: { postId } });
    return { liked: !existing, likesCount };
  }

  async addComment(postId: string, userId: string, content: string) {
    await this.findPublished(postId);
    const comment = await this.prisma.brandPostComment.create({ data: { postId, userId, content: content.trim() } });
    return withAuthor(comment, await this.authorsById([userId]));
  }

  async listComments(postId: string) {
    await this.findPublished(postId);
    const comments = await this.prisma.brandPostComment.findMany({ where: { postId }, orderBy: { createdAt: 'asc' }, take: 500 });
    const authors = await this.authorsById(comments.map((c) => c.userId));
    return comments.map((c) => withAuthor(c, authors));
  }

  /** Users can remove their own comments. */
  async deleteComment(postId: string, commentId: string, userId: string) {
    const comment = await this.prisma.brandPostComment.findFirst({ where: { id: commentId, postId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) throw new ForbiddenException('You can only delete your own comments');
    await this.prisma.brandPostComment.delete({ where: { id: commentId } });
    return { deleted: true, commentsCount: await this.prisma.brandPostComment.count({ where: { postId } }) };
  }

  /**
   * Bookmarking a brand post saves it to the user's Saved looks, so it sits next to
   * their own looks and opens straight in Drape. The look is matched by image, so
   * saving again removes it.
   */
  async toggleSave(postId: string, userId: string) {
    const post = await this.findPublished(postId);
    const image = firstImage(post.images);
    if (!image) throw new BadRequestException('This post has no image to save');

    const existing = await this.prisma.look.findFirst({ where: { userId, image }, select: { id: true } });
    if (existing) {
      await this.prisma.look.delete({ where: { id: existing.id } });
      return { saved: false };
    }

    const title = (post.title || post.caption || 'Look').replace(/\s+/g, ' ').trim();
    const products = Array.isArray(post.taggedProducts)
      ? (post.taggedProducts as { name?: unknown }[]).map((p) => (typeof p?.name === 'string' ? p.name : '')).filter(Boolean)
      : [];
    const look = await this.prisma.look.create({
      data: {
        userId,
        name: `${post.brand.name}: ${title}`.slice(0, 80),
        occasion: occasionFor(post.category),
        image,
        pieces: products.length ? products : [post.category || post.brand.name],
      },
    });
    return { saved: true, lookId: look.id };
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
