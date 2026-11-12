import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { APP_CONSTANTS } from '../../../common/constants/app.constant';
import { buildPaginationMeta } from '../../../common/dto/pagination-query.dto';
import { decodeCursor, encodeCursor, sliceByLimit } from '../../../common/pagination/cursor';
import { FeedQueryDto } from './feed-query.dto';

type CommentRow = { id: string; productId: string; userId: string; content: string; createdAt: Date };
type CommentAuthor = { id: string; username: string; avatar: string | null };

/** What the feed needs per piece: its brand, counts and the two newest comments. */
const FEED_INCLUDE = {
  brand: { select: { id: true, name: true, slug: true, logoUrl: true, isVerified: true } },
  _count: { select: { likes: true, comments: true } },
  comments: { take: 2, orderBy: { createdAt: 'desc' as const } },
} satisfies Prisma.BrandProductInclude;

/** Only live pieces of approved brands are ever shown to shoppers. */
const LIVE = { status: 'PUBLISHED', brand: { isDeleted: false, status: 'ACTIVE' } } as const satisfies Prisma.BrandProductWhereInput;

const withAuthor = (c: CommentRow, authors: Map<string, CommentAuthor>) => ({
  id: c.id,
  // Kept as "postId" so the existing app code keeps working: it is the piece's id.
  postId: c.productId,
  userId: c.userId,
  content: c.content,
  createdAt: c.createdAt,
  user: authors.get(c.userId) ?? { id: c.userId, username: 'member', avatar: null },
});

/** A saved look needs an occasion; map the piece's category onto the look occasions. */
function occasionFor(category?: string | null) {
  const c = (category ?? '').toLowerCase();
  if (c.includes('formal')) return 'formal';
  if (c.includes('ethnic') || c.includes('navratri') || c.includes('wedding')) return 'festive';
  return 'casual';
}

/** Sizes and colours become the variant chips the app already knows how to show; none means no chips. */
function variantsOf(p: { id: string; title: string; price: number; stock: number; sizes: string[]; colors: string[]; images: string[] }) {
  const sizes = p.sizes.length ? p.sizes : [''];
  const colors = p.colors.length ? p.colors : [''];
  if (p.sizes.length === 0 && p.colors.length === 0) return [];
  const out: unknown[] = [];
  for (const color of colors) {
    for (const size of sizes) {
      if (out.length >= 24) break;
      out.push({ id: `v_${p.id}_${out.length}`, productName: p.title, size, color, colorHex: null, price: p.price > 0 ? Math.round(p.price) : null, inStock: p.stock > 0, stockCount: p.stock, productUrl: null, imageUrl: p.images[0] ?? null });
    }
  }
  return out;
}

/** Offset pages are only for older clients: past this many rows the request must use a cursor. */
const MAX_OFFSET_ROWS = 1000;

type FeedCursor = { id: string; p: string | null };

/** Newest first. Rows with no publish time (very old imports) come last, in id order. */
const FEED_ORDER: Prisma.BrandProductOrderByWithRelationInput[] = [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }];

/** "Everything after this piece" in feed order. */
export function afterFeedCursor(cur: FeedCursor): Prisma.BrandProductWhereInput {
  if (cur.p === null) return { publishedAt: null, id: { lt: cur.id } };
  const when = new Date(cur.p);
  return { OR: [{ publishedAt: { lt: when } }, { publishedAt: when, id: { lt: cur.id } }, { publishedAt: null }] };
}

type FeedRow = Prisma.BrandProductGetPayload<{ include: typeof FEED_INCLUDE }>;

/**
 * The Discover / Trending feed and its engagement (likes, saves, shares, comments), served from the catalog.
 * It answers in the shape the app already reads from /brand-posts, so a piece in the catalog IS a post:
 * one place for brands to manage it, one feed for shoppers.
 */
@Injectable()
export class CatalogFeedService {
  constructor(private readonly prisma: PrismaService) {}

  private shape(p: FeedRow, extra: { likedByMe: boolean; savedByMe: boolean; latestComments: unknown[] }) {
    const { comments: _c, _count, ...rest } = p;
    return {
      id: p.id,
      brandId: p.brandId,
      title: p.title,
      caption: p.description ?? p.title,
      images: p.images,
      category: p.category,
      taggedProducts: [{ name: p.title, brand: p.brand.name, price: p.price > 0 ? String(p.price) : '', thumbnail: p.images[0] ?? '' }],
      status: 'PUBLISHED',
      scheduledAt: null,
      publishedAt: p.publishedAt ?? p.createdAt,
      sharesCount: p.sharesCount,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      brand: rest.brand,
      variants: variantsOf(p),
      // The Buy button goes through /brands/products/:id/go so the brand sees the click.
      productId: p.id,
      hasBuyLink: p.buyUrl.trim().length > 0,
      likesCount: _count.likes,
      commentsCount: _count.comments,
      ...extra,
    };
  }

  private async engagement(rows: FeedRow[], userId?: string) {
    const ids = rows.map((r) => r.id);
    const images = rows.map((r) => r.images[0]).filter(Boolean);
    const [likes, saves, authors] = await Promise.all([
      userId && ids.length ? this.prisma.brandProductLike.findMany({ where: { userId, productId: { in: ids } }, select: { productId: true } }) : [],
      userId && images.length ? this.prisma.look.findMany({ where: { userId, image: { in: images } }, select: { image: true } }) : [],
      this.authorsById(rows.flatMap((r) => r.comments.map((c) => c.userId))),
    ]);
    const liked = new Set(likes.map((l) => l.productId));
    const saved = new Set(saves.map((s) => s.image));
    return (r: FeedRow) => ({
      likedByMe: liked.has(r.id),
      savedByMe: saved.has(r.images[0] ?? ''),
      // Fetched newest-first; shown oldest-first like a thread.
      latestComments: r.comments.map((c) => withAuthor(c, authors)).reverse(),
    });
  }

  async findAllPublic(filter: FeedQueryDto, userId?: string) {
    const limit = Math.min(filter.limit ?? APP_CONSTANTS.pagination.defaultLimit, APP_CONSTANTS.pagination.maxLimit);
    const where: Prisma.BrandProductWhereInput = { ...LIVE };
    if (filter.brandId) where.brandId = filter.brandId;
    if (filter.category) where.category = { equals: filter.category, mode: 'insensitive' };
    const term = filter.q?.trim();
    if (term) where.OR = [{ title: { contains: term, mode: 'insensitive' } }, { description: { contains: term, mode: 'insensitive' } }];

    // Older clients ask for a page number: keep answering them, with a ceiling.
    if (filter.page && !filter.cursor) {
      if (filter.page * limit > MAX_OFFSET_ROWS) throw new BadRequestException('That page is too far down. Use the cursor from the previous page instead.');
      const [rows, total] = await Promise.all([
        this.prisma.brandProduct.findMany({ where, skip: (filter.page - 1) * limit, take: limit, orderBy: FEED_ORDER, include: FEED_INCLUDE }),
        this.prisma.brandProduct.count({ where }),
      ]);
      const eng = await this.engagement(rows, userId);
      return { posts: rows.map((r) => this.shape(r, eng(r))), meta: buildPaginationMeta(total, filter.page, limit) };
    }

    const page = filter.cursor ? { AND: [where, afterFeedCursor(decodeCursor<FeedCursor>(filter.cursor))] } : where;
    const [rows, total] = await Promise.all([
      this.prisma.brandProduct.findMany({ where: page, take: limit + 1, orderBy: FEED_ORDER, include: FEED_INCLUDE }),
      // The total costs a full count, so it is only worked out for the first page.
      filter.cursor ? Promise.resolve(null) : this.prisma.brandProduct.count({ where }),
    ]);
    const { page: pageRows, more } = sliceByLimit(rows, limit);
    const last = pageRows[pageRows.length - 1];
    const nextCursor = more && last ? encodeCursor({ id: last.id, p: last.publishedAt ? last.publishedAt.toISOString() : null } satisfies FeedCursor) : null;
    const eng = await this.engagement(pageRows, userId);
    return { posts: pageRows.map((r) => this.shape(r, eng(r))), meta: { limit, total, nextCursor, hasMore: more } };
  }

  /** One live piece; an id from an old post link still resolves to the piece that replaced the post. */
  async findOnePublic(id: string, userId?: string) {
    const row =
      (await this.prisma.brandProduct.findFirst({ where: { id, ...LIVE }, include: FEED_INCLUDE })) ??
      (await this.prisma.brandProduct.findFirst({ where: { sourcePostId: id, ...LIVE }, include: FEED_INCLUDE }));
    if (!row) throw new NotFoundException('Post not found');
    const eng = await this.engagement([row], userId);
    return this.shape(row, eng(row));
  }

  private async findLive(id: string) {
    const row =
      (await this.prisma.brandProduct.findFirst({ where: { id, ...LIVE }, select: { id: true, title: true, description: true, images: true, category: true, brand: { select: { name: true } } } })) ??
      (await this.prisma.brandProduct.findFirst({ where: { sourcePostId: id, ...LIVE }, select: { id: true, title: true, description: true, images: true, category: true, brand: { select: { name: true } } } }));
    if (!row) throw new NotFoundException('Post not found');
    return row;
  }

  async toggleLike(id: string, userId: string) {
    const { id: productId } = await this.findLive(id);
    const existing = await this.prisma.brandProductLike.findUnique({ where: { productId_userId: { productId, userId } } });
    if (existing) {
      await this.prisma.brandProductLike.delete({ where: { productId_userId: { productId, userId } } });
    } else {
      // A double tap can race two creates; the unique (productId, userId) index makes the second a no-op.
      await this.prisma.brandProductLike.createMany({ data: [{ productId, userId }], skipDuplicates: true });
    }
    return { liked: !existing, likesCount: await this.prisma.brandProductLike.count({ where: { productId } }) };
  }

  async recordShare(id: string) {
    const { id: productId } = await this.findLive(id);
    const row = await this.prisma.brandProduct.update({ where: { id: productId }, data: { sharesCount: { increment: 1 } }, select: { sharesCount: true } });
    return { sharesCount: row.sharesCount };
  }

  /** Bookmarking saves the piece to the user's Saved looks, matched by image, so saving again removes it. */
  async toggleSave(id: string, userId: string) {
    const p = await this.findLive(id);
    const image = p.images[0];
    if (!image) throw new BadRequestException('This post has no image to save');
    const existing = await this.prisma.look.findFirst({ where: { userId, image }, select: { id: true } });
    if (existing) {
      await this.prisma.look.delete({ where: { id: existing.id } });
      return { saved: false };
    }
    const title = (p.title || p.description || 'Look').replace(/\s+/g, ' ').trim();
    const look = await this.prisma.look.create({
      data: { userId, name: `${p.brand.name}: ${title}`.slice(0, 80), occasion: occasionFor(p.category), image, pieces: [p.title || p.category || p.brand.name] },
    });
    return { saved: true, lookId: look.id };
  }

  /** Public author fields only: comments are visible to everyone, so emails are never exposed. */
  private async authorsById(userIds: string[]): Promise<Map<string, CommentAuthor>> {
    if (userIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, username: true, email: true, avatar: true } });
    return new Map(users.map((u) => [u.id, { id: u.id, username: u.username || `${u.email.split('@')[0].slice(0, 2)}•••`, avatar: u.avatar }]));
  }

  async listComments(id: string) {
    const { id: productId } = await this.findLive(id);
    const comments = await this.prisma.brandProductComment.findMany({ where: { productId }, orderBy: { createdAt: 'asc' }, take: 500 });
    const authors = await this.authorsById(comments.map((c) => c.userId));
    return comments.map((c) => withAuthor(c, authors));
  }

  async addComment(id: string, userId: string, content: string) {
    const { id: productId } = await this.findLive(id);
    const comment = await this.prisma.brandProductComment.create({ data: { productId, userId, content: content.trim() } });
    return withAuthor(comment, await this.authorsById([userId]));
  }

  /** Users can remove their own comments. */
  async deleteComment(id: string, commentId: string, userId: string) {
    const { id: productId } = await this.findLive(id);
    const comment = await this.prisma.brandProductComment.findFirst({ where: { id: commentId, productId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) throw new ForbiddenException('You can only delete your own comments');
    await this.prisma.brandProductComment.delete({ where: { id: commentId } });
    return { deleted: true, commentsCount: await this.prisma.brandProductComment.count({ where: { productId } }) };
  }
}
