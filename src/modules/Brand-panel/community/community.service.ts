import { BadRequestException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationsService } from '../../User-panel/notifications/notifications.service';
import { BrandNotifyService } from '../notify/brand-notify';

const DAY = 86_400_000;
export const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
export const MAX_POLL_OPTIONS = 4;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const handle = (u: { username: string | null } | null | undefined) => u?.username || 'Shopper';

/** The milestone a follower count last passed, and the next one to aim for. */
export function milestones(count: number) {
  const reached = MILESTONES.filter((m) => count >= m);
  return { last: reached.at(-1) ?? null, next: MILESTONES.find((m) => count < m) ?? null };
}

/** Poll results as shares, and which option the viewer picked. */
export function pollResults(options: string[], votes: { option: number; userId: string }[], viewerId?: string) {
  const counts = options.map((_, i) => votes.filter((v) => v.option === i).length);
  const total = counts.reduce((a, b) => a + b, 0);
  return {
    total,
    options: options.map((label, i) => ({ label, votes: counts[i], share: total ? Math.round((counts[i] / total) * 100) : 0 })),
    myVote: viewerId ? votes.find((v) => v.userId === viewerId)?.option ?? null : null,
  };
}

/**
 * Blueprint 3.8, both sides of it: followers and milestones, updates and polls, the brand inbox,
 * reviews and Q&A with brand replies, and shoppers' looks. Brands only ever see what shoppers chose
 * to send them (a question, a review, a submitted look) and never anyone's wardrobe or photos.
 */
@Injectable()
export class CommunityService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly brandMail?: BrandNotifyService,
  ) {}

  private notify(userId: string, input: { type: string; title: string; body?: string; link?: string }) {
    void this.notifications?.createMany([userId], input).catch(() => undefined);
  }

  private async liveBrand(slug: string) {
    const b = await this.prisma.brand.findFirst({ where: { slug, isDeleted: false, status: 'ACTIVE' }, select: { id: true, name: true, slug: true } });
    if (!b) throw new NotFoundException('Brand not found.');
    return b;
  }

  // ── Followers ──────────────────────────────────────────────────────────

  /** Count, weekly growth over 12 weeks, and milestones. Followers are counted, never listed. */
  async followers(brandId: string) {
    const since = new Date(Date.now() - 12 * 7 * DAY);
    const [count, recent] = await Promise.all([this.prisma.brandFollow.count({ where: { brandId } }), this.prisma.brandFollow.findMany({ where: { brandId, createdAt: { gte: since } }, select: { createdAt: true } })]);
    const weeks = Array.from({ length: 12 }, (_, i) => {
      const start = new Date(since.getTime() + i * 7 * DAY);
      return { weekOf: start.toISOString().slice(0, 10), gained: recent.filter((r) => r.createdAt >= start && r.createdAt < new Date(start.getTime() + 7 * DAY)).length };
    });
    return { count, gainedLast30: recent.filter((r) => r.createdAt.getTime() > Date.now() - 30 * DAY).length, weeks, ...milestones(count) };
  }

  // ── Updates & polls ────────────────────────────────────────────────────

  async createUpdate(brandId: string, input: { body: string; media?: string[]; productIds?: string[]; pollOptions?: string[]; pollDays?: number }) {
    const body = text(input.body, 1000);
    if (!body) throw new BadRequestException('Write something to post.');
    const options = (input.pollOptions ?? []).map((o) => text(o, 60)).filter(Boolean);
    if (options.length === 1 || options.length > MAX_POLL_OPTIONS) throw new BadRequestException(`A poll needs 2 to ${MAX_POLL_OPTIONS} options.`);
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new BadRequestException('Poll options must be different.');
    const media = (input.media ?? []).map((m) => text(m, 2000)).filter((m) => /^(https:\/\/|\/)/.test(m)).slice(0, 4);
    const own = input.productIds?.length ? await this.prisma.brandProduct.findMany({ where: { brandId, status: 'PUBLISHED', id: { in: input.productIds } }, select: { id: true } }) : [];
    const row = await this.prisma.brandUpdate.create({
      data: {
        brandId,
        kind: options.length ? 'POLL' : 'UPDATE',
        body,
        media,
        productIds: own.map((p) => p.id).slice(0, 6),
        pollOptions: options,
        pollEndsAt: options.length ? new Date(Date.now() + Math.min(Math.max(input.pollDays ?? 3, 1), 14) * DAY) : null,
      },
      include: { votes: { select: { option: true, userId: true } } },
    });
    return this.updateView(row);
  }

  private updateView(u: { id: string; kind: string; body: string; media: string[]; productIds: string[]; pollOptions: string[]; pollEndsAt: Date | null; publishedAt: Date; votes: { option: number; userId: string }[] }, viewerId?: string) {
    return {
      id: u.id,
      kind: u.kind as 'UPDATE' | 'POLL',
      body: u.body,
      media: u.media,
      productIds: u.productIds,
      publishedAt: u.publishedAt.toISOString(),
      poll: u.kind === 'POLL' ? { ...pollResults(u.pollOptions, u.votes, viewerId), endsAt: u.pollEndsAt?.toISOString() ?? null, open: !u.pollEndsAt || u.pollEndsAt.getTime() > Date.now() } : null,
    };
  }

  async listUpdates(brandId: string, viewerId?: string, take = 20) {
    const rows = await this.prisma.brandUpdate.findMany({ where: { brandId, isDeleted: false }, orderBy: { publishedAt: 'desc' }, take, include: { votes: { select: { option: true, userId: true } } } });
    return rows.map((r) => this.updateView(r, viewerId));
  }

  async deleteUpdate(brandId: string, id: string) {
    const { count } = await this.prisma.brandUpdate.updateMany({ where: { id, brandId }, data: { isDeleted: true } });
    if (!count) throw new NotFoundException('Update not found.');
    return { deleted: true };
  }

  async publicUpdates(slug: string, viewerId?: string) {
    const b = await this.liveBrand(slug);
    return this.listUpdates(b.id, viewerId, 10);
  }

  /** Updates from every brand the shopper follows, newest first. */
  async followingFeed(userId: string) {
    const follows = await this.prisma.brandFollow.findMany({ where: { userId, brand: { isDeleted: false, status: 'ACTIVE' } }, select: { brandId: true } });
    if (follows.length === 0) return [];
    const rows = await this.prisma.brandUpdate.findMany({
      where: { brandId: { in: follows.map((f) => f.brandId) }, isDeleted: false, publishedAt: { gte: new Date(Date.now() - 30 * DAY) } },
      orderBy: { publishedAt: 'desc' },
      take: 20,
      include: { votes: { select: { option: true, userId: true } }, brand: { select: { id: true, name: true, slug: true, logoUrl: true } } },
    });
    return rows.map((r) => ({ ...this.updateView(r, userId), brand: { id: r.brand.id, name: r.brand.name, slug: r.brand.slug, logo: r.brand.logoUrl ?? '' } }));
  }

  async vote(userId: string, updateId: string, option: number) {
    const u = await this.prisma.brandUpdate.findFirst({ where: { id: updateId, isDeleted: false, kind: 'POLL', brand: { isDeleted: false, status: 'ACTIVE' } } });
    if (!u) throw new NotFoundException('Poll not found.');
    if (u.pollEndsAt && u.pollEndsAt.getTime() <= Date.now()) throw new BadRequestException('This poll has closed.');
    if (!Number.isInteger(option) || option < 0 || option >= u.pollOptions.length) throw new BadRequestException('Pick one of the options.');
    await this.prisma.brandPollVote.upsert({ where: { updateId_userId: { updateId, userId } }, create: { updateId, userId, option }, update: { option } });
    const votes = await this.prisma.brandPollVote.findMany({ where: { updateId }, select: { option: true, userId: true } });
    return pollResults(u.pollOptions, votes, userId);
  }

  // ── Inbox ──────────────────────────────────────────────────────────────

  /** A shopper asks a brand something. It joins their open conversation with the brand, or starts one. */
  async ask(userId: string, slug: string, input: { body: string; productId?: string }) {
    const b = await this.liveBrand(slug);
    const body = text(input.body, 2000);
    if (body.length < 2) throw new BadRequestException('Write your question.');
    const productId = input.productId ? (await this.prisma.brandProduct.findFirst({ where: { id: input.productId, brandId: b.id }, select: { id: true } }))?.id ?? null : null;
    const open = await this.prisma.brandThread.findFirst({ where: { brandId: b.id, userId, status: 'OPEN' }, orderBy: { lastMessageAt: 'desc' } });
    const thread = open
      ? await this.prisma.brandThread.update({ where: { id: open.id }, data: { lastMessageAt: new Date(), brandUnread: { increment: 1 }, ...(productId ? { productId } : {}) } })
      : await this.prisma.brandThread.create({ data: { brandId: b.id, userId, productId, brandUnread: 1 } });
    await this.prisma.brandThreadMessage.create({ data: { threadId: thread.id, fromBrand: false, body } });
    // Only a new conversation emails the team; follow-ups in an open one show as unread in the inbox.
    if (!open) this.brandMail?.send(b.id, 'inbox', { subject: `New message for ${b.name}`, lines: ['A shopper sent you a message:', body.slice(0, 300)], path: '/community?tab=inbox' });
    return this.shopperThread(userId, thread.id);
  }

  async myThreads(userId: string) {
    const rows = await this.prisma.brandThread.findMany({ where: { userId }, orderBy: { lastMessageAt: 'desc' }, take: 50, include: { brand: { select: { name: true, slug: true, logoUrl: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    return rows.map((t) => ({ id: t.id, brand: { name: t.brand.name, slug: t.brand.slug, logo: t.brand.logoUrl ?? '' }, unread: t.userUnread, status: t.status, lastMessageAt: t.lastMessageAt.toISOString(), last: t.messages[0] ? { body: t.messages[0].body.slice(0, 140), fromBrand: t.messages[0].fromBrand } : null }));
  }

  async shopperThread(userId: string, threadId: string) {
    const t = await this.prisma.brandThread.findFirst({ where: { id: threadId, userId }, include: { brand: { select: { name: true, slug: true, logoUrl: true } }, messages: { orderBy: { createdAt: 'asc' }, take: 200 } } });
    if (!t) throw new NotFoundException('Conversation not found.');
    if (t.userUnread) await this.prisma.brandThread.update({ where: { id: t.id }, data: { userUnread: 0 } });
    return { id: t.id, status: t.status, brand: { name: t.brand.name, slug: t.brand.slug, logo: t.brand.logoUrl ?? '' }, messages: t.messages.map((m) => ({ id: m.id, fromBrand: m.fromBrand, body: m.body, at: m.createdAt.toISOString() })) };
  }

  async inbox(brandId: string, status: 'OPEN' | 'CLOSED' | 'ALL' = 'OPEN') {
    const rows = await this.prisma.brandThread.findMany({
      where: { brandId, ...(status === 'ALL' ? {} : { status }) },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: { user: { select: { username: true } }, messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    const products = await this.prisma.brandProduct.findMany({ where: { id: { in: rows.map((r) => r.productId).filter((x): x is string => Boolean(x)) } }, select: { id: true, title: true } });
    const pt = new Map(products.map((p) => [p.id, p.title]));
    return rows.map((t) => ({ id: t.id, shopper: handle(t.user), product: t.productId ? pt.get(t.productId) ?? null : null, unread: t.brandUnread, status: t.status, lastMessageAt: t.lastMessageAt.toISOString(), last: t.messages[0] ? { body: t.messages[0].body.slice(0, 140), fromBrand: t.messages[0].fromBrand } : null }));
  }

  async brandThread(brandId: string, threadId: string) {
    const t = await this.prisma.brandThread.findFirst({ where: { id: threadId, brandId }, include: { user: { select: { username: true } }, messages: { orderBy: { createdAt: 'asc' }, take: 200 } } });
    if (!t) throw new NotFoundException('Conversation not found.');
    if (t.brandUnread) await this.prisma.brandThread.update({ where: { id: t.id }, data: { brandUnread: 0 } });
    const product = t.productId ? await this.prisma.brandProduct.findUnique({ where: { id: t.productId }, select: { title: true, images: true } }) : null;
    return { id: t.id, status: t.status, shopper: handle(t.user), product: product ? { title: product.title, image: product.images[0] ?? '' } : null, messages: t.messages.map((m) => ({ id: m.id, fromBrand: m.fromBrand, body: m.body, at: m.createdAt.toISOString() })) };
  }

  async replyAsBrand(brandId: string, brandAccountId: string, threadId: string, body: string) {
    const t = await this.prisma.brandThread.findFirst({ where: { id: threadId, brandId }, include: { brand: { select: { name: true, slug: true } } } });
    if (!t) throw new NotFoundException('Conversation not found.');
    const clean = text(body, 2000);
    if (!clean) throw new BadRequestException('Write a reply.');
    await this.prisma.$transaction([
      this.prisma.brandThreadMessage.create({ data: { threadId, fromBrand: true, body: clean, brandAccountId } }),
      this.prisma.brandThread.update({ where: { id: threadId }, data: { lastMessageAt: new Date(), userUnread: { increment: 1 }, brandUnread: 0, status: 'OPEN' } }),
    ]);
    this.notify(t.userId, { type: 'BRAND_REPLY', title: `${t.brand.name} replied`, body: clean.slice(0, 120), link: `/brands/${t.brand.slug}?inbox=1` });
    return this.brandThread(brandId, threadId);
  }

  async replyAsShopper(userId: string, threadId: string, body: string) {
    const t = await this.prisma.brandThread.findFirst({ where: { id: threadId, userId } });
    if (!t) throw new NotFoundException('Conversation not found.');
    const clean = text(body, 2000);
    if (!clean) throw new BadRequestException('Write a message.');
    await this.prisma.$transaction([
      this.prisma.brandThreadMessage.create({ data: { threadId, fromBrand: false, body: clean } }),
      this.prisma.brandThread.update({ where: { id: threadId }, data: { lastMessageAt: new Date(), brandUnread: { increment: 1 }, status: 'OPEN' } }),
    ]);
    return this.shopperThread(userId, threadId);
  }

  async setThreadStatus(brandId: string, threadId: string, status: 'OPEN' | 'CLOSED') {
    const { count } = await this.prisma.brandThread.updateMany({ where: { id: threadId, brandId }, data: { status } });
    if (!count) throw new NotFoundException('Conversation not found.');
    return { status };
  }

  savedReplies(brandId: string) {
    return this.prisma.brandSavedReply.findMany({ where: { brandId }, orderBy: { createdAt: 'asc' }, select: { id: true, title: true, body: true } });
  }

  async addSavedReply(brandId: string, input: { title: string; body: string }) {
    const title = text(input.title, 60);
    const body = text(input.body, 2000);
    if (!title || !body) throw new BadRequestException('A saved reply needs a name and the text.');
    if ((await this.prisma.brandSavedReply.count({ where: { brandId } })) >= 30) throw new BadRequestException('You can keep up to 30 saved replies.');
    return this.prisma.brandSavedReply.create({ data: { brandId, title, body }, select: { id: true, title: true, body: true } });
  }

  async deleteSavedReply(brandId: string, id: string) {
    await this.prisma.brandSavedReply.deleteMany({ where: { id, brandId } });
    return { deleted: true };
  }

  // ── Reviews & Q&A ──────────────────────────────────────────────────────

  /**
   * A shopper reviews a piece. Only shoppers who tried it on or saved it can, so reviews come from
   * people who actually looked at it closely. Reviewing again updates the review.
   */
  async review(userId: string, productId: string, input: { rating: number; body?: string }) {
    const p = await this.prisma.brandProduct.findFirst({ where: { id: productId, status: 'PUBLISHED', brand: { isDeleted: false, status: 'ACTIVE' } }, select: { id: true, brandId: true } });
    if (!p) throw new NotFoundException('Piece not found.');
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new BadRequestException('Give 1 to 5 stars.');
    const engaged = await this.prisma.brandEvent.count({ where: { productId, userId, type: { in: ['DRAPE', 'SAVE'] } } });
    if (!engaged) throw new ForbiddenException('Try this piece on (or save it) first, then you can review it.');
    const body = text(input.body, 1500) || null;
    const before = await this.prisma.brandProductReview.findUnique({ where: { productId_userId: { productId, userId } }, select: { id: true } });
    await this.prisma.brandProductReview.upsert({ where: { productId_userId: { productId, userId } }, create: { productId, brandId: p.brandId, userId, rating: input.rating, body }, update: { rating: input.rating, body } });
    if (!before) this.brandMail?.send(p.brandId, 'reviews', { subject: `New ${input.rating}-star review`, lines: [`A shopper gave one of your pieces ${input.rating} out of 5.`, ...(body ? [body.slice(0, 300)] : [])], path: '/community?tab=reviews' });
    return this.productReviews(productId, userId);
  }

  async productReviews(productId: string, viewerId?: string) {
    const [rows, agg] = await Promise.all([
      this.prisma.brandProductReview.findMany({ where: { productId }, orderBy: { createdAt: 'desc' }, take: 30, include: { user: { select: { username: true } } } }),
      this.prisma.brandProductReview.aggregate({ where: { productId }, _avg: { rating: true }, _count: { _all: true } }),
    ]);
    const canReview = viewerId ? (await this.prisma.brandEvent.count({ where: { productId, userId: viewerId, type: { in: ['DRAPE', 'SAVE'] } } })) > 0 : false;
    return {
      average: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : null,
      count: agg._count._all,
      canReview,
      mine: viewerId ? rows.find((r) => r.userId === viewerId)?.id ?? null : null,
      items: rows.map((r) => ({ id: r.id, by: handle(r.user), rating: r.rating, body: r.body, brandReply: r.brandReply, at: r.createdAt.toISOString() })),
    };
  }

  async brandReviews(brandId: string, filter: 'all' | 'unanswered' = 'all') {
    const rows = await this.prisma.brandProductReview.findMany({ where: { brandId, ...(filter === 'unanswered' ? { brandReply: null } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { username: true } }, product: { select: { title: true, images: true } } } });
    const agg = await this.prisma.brandProductReview.aggregate({ where: { brandId }, _avg: { rating: true }, _count: { _all: true } });
    return {
      average: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : null,
      count: agg._count._all,
      items: rows.map((r) => ({ id: r.id, by: handle(r.user), rating: r.rating, body: r.body, brandReply: r.brandReply, at: r.createdAt.toISOString(), product: { title: r.product.title, image: r.product.images[0] ?? '' } })),
    };
  }

  async replyToReview(brandId: string, reviewId: string, reply: string) {
    const r = await this.prisma.brandProductReview.findFirst({ where: { id: reviewId, brandId }, include: { brand: { select: { name: true, slug: true } } } });
    if (!r) throw new NotFoundException('Review not found.');
    const clean = text(reply, 1000) || null;
    await this.prisma.brandProductReview.update({ where: { id: reviewId }, data: { brandReply: clean, brandRepliedAt: clean ? new Date() : null } });
    if (clean) this.notify(r.userId, { type: 'BRAND_REVIEW_REPLY', title: `${r.brand.name} replied to your review`, body: clean.slice(0, 120), link: `/brands/${r.brand.slug}` });
    return { id: reviewId, brandReply: clean };
  }

  /** Shoppers' questions and comments on the brand's pieces, newest first. */
  async questions(brandId: string, filter: 'all' | 'unanswered' = 'unanswered') {
    const rows = await this.prisma.brandProductComment.findMany({ where: { product: { brandId }, ...(filter === 'unanswered' ? { brandReply: null } : {}) }, orderBy: { createdAt: 'desc' }, take: 100, include: { product: { select: { title: true, images: true } } } });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, username: true } });
    const name = new Map(users.map((u) => [u.id, handle(u)]));
    return rows.map((r) => ({ id: r.id, by: name.get(r.userId) ?? 'Shopper', body: r.content, brandReply: r.brandReply, at: r.createdAt.toISOString(), product: { title: r.product.title, image: r.product.images[0] ?? '' } }));
  }

  async answerQuestion(brandId: string, commentId: string, reply: string) {
    const c = await this.prisma.brandProductComment.findFirst({ where: { id: commentId, product: { brandId } }, include: { product: { select: { brand: { select: { name: true, slug: true } } } } } });
    if (!c) throw new NotFoundException('Question not found.');
    const clean = text(reply, 1000) || null;
    await this.prisma.brandProductComment.update({ where: { id: commentId }, data: { brandReply: clean, brandRepliedAt: clean ? new Date() : null } });
    if (clean) this.notify(c.userId, { type: 'BRAND_ANSWER', title: `${c.product.brand.name} answered your question`, body: clean.slice(0, 120), link: `/brands/${c.product.brand.slug}` });
    return { id: commentId, brandReply: clean };
  }

  // ── Shoppers' looks (UGC) ──────────────────────────────────────────────

  /** A shopper sends one of their own saved looks to a brand. Nothing is public until the brand approves. */
  async submitLook(userId: string, slug: string, input: { lookId: string; caption?: string; showName?: boolean }) {
    const b = await this.liveBrand(slug);
    const look = await this.prisma.look.findFirst({ where: { id: input.lookId, userId }, select: { id: true, image: true } });
    if (!look) throw new NotFoundException('That look is not in your saved looks.');
    const existing = await this.prisma.brandUgc.findUnique({ where: { brandId_lookId: { brandId: b.id, lookId: look.id } } });
    if (existing) return { id: existing.id, status: existing.status };
    const row = await this.prisma.brandUgc.create({ data: { brandId: b.id, userId, lookId: look.id, imageUrl: look.image, caption: text(input.caption, 200) || null, showName: input.showName ?? true } });
    this.brandMail?.send(b.id, 'looks', { subject: `A shopper sent ${b.name} a look`, lines: ['A shopper styled your pieces and sent the look for your store. It stays hidden until you approve it.'], path: '/community?tab=looks' });
    return { id: row.id, status: row.status };
  }

  async brandLooks(brandId: string, status: 'PENDING' | 'APPROVED' | 'DECLINED' = 'PENDING') {
    const rows = await this.prisma.brandUgc.findMany({ where: { brandId, status }, orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { username: true } } } });
    return rows.map((r) => ({ id: r.id, imageUrl: r.imageUrl, caption: r.caption, by: r.showName ? handle(r.user) : 'A shopper', status: r.status, at: r.createdAt.toISOString() }));
  }

  async decideLook(brandId: string, id: string, decision: 'APPROVED' | 'DECLINED') {
    const r = await this.prisma.brandUgc.findFirst({ where: { id, brandId }, include: { brand: { select: { name: true, slug: true } } } });
    if (!r) throw new NotFoundException('Look not found.');
    await this.prisma.brandUgc.update({ where: { id }, data: { status: decision, decidedAt: new Date() } });
    if (decision === 'APPROVED' && r.status !== 'APPROVED') this.notify(r.userId, { type: 'UGC_APPROVED', title: `${r.brand.name} featured your look`, body: 'It now shows on their store.', link: `/brands/${r.brand.slug}` });
    return { id, status: decision };
  }

  /** Approved looks for the store page. A shopper who chose not to be named shows as "A shopper". */
  async publicLooks(slug: string) {
    const b = await this.liveBrand(slug);
    const rows = await this.prisma.brandUgc.findMany({ where: { brandId: b.id, status: 'APPROVED' }, orderBy: { decidedAt: 'desc' }, take: 24, include: { user: { select: { username: true } } } });
    return rows.map((r) => ({ id: r.id, imageUrl: r.imageUrl, caption: r.caption, by: r.showName ? handle(r.user) : 'A shopper' }));
  }
}
