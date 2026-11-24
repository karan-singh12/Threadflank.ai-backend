import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../shared/audit/audit-log.service';
import { buildPaginationMeta } from '../../../common/dto/pagination-query.dto';
import { AuthenticatedAdmin } from '../../../common/interfaces/admin-jwt-payload.interface';
import { BrandAccessService } from '../brands/brand-access.service';
import { BrandBillingService } from '../../Brand-panel/billing/brand-billing.service';
import { RankingService } from '../../Brand-panel/ranking/ranking.service';
import { monthKey } from '../../Brand-panel/ranking/ranking-formula';
import { activePlan, findPlan, planUsage, PLANS } from '../../Brand-panel/billing/plans';
import { notifyPrefsOf } from '../../Brand-panel/notify/brand-notify';
import { AdminCatalogQueryDto, AdminCatalogStatusDto, GstDecisionDto, InviteOwnerDto, LookDecisionDto, SetPlanDto } from './brand-management.dto';
import { BrandAuthService } from '../../Brand-panel/auth/brand-auth.service';

const DAY = 86_400_000;

/**
 * The parts of brand management that came with the brand panel's later modules: plans, GST,
 * purchases, community moderation, rankings, and one catalog across every brand.
 * Every brand-specific call checks access first, so a BRAND_MANAGER only reaches their own brands.
 */
@Injectable()
export class BrandManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BrandAccessService,
    private readonly audit: AuditLogService,
    private readonly billing: BrandBillingService,
    private readonly ranking: RankingService,
    private readonly brandAuth: BrandAuthService,
  ) {}

  private async brand(id: string, admin: AuthenticatedAdmin) {
    await this.access.assertAccess(admin, id);
    const brand = await this.prisma.brand.findFirst({ where: { id, isDeleted: false } });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  // ── Plan, GST, notifications ───────────────────────────────────────────

  /** Everything the admin brand page shows next to the basics. */
  async account(id: string, admin: AuthenticatedAdmin) {
    const b = await this.brand(id, admin);
    const plan = activePlan(b);
    const [usage, campaigns, reviews, pendingLooks, openThreads, updates, collabs] = await Promise.all([
      planUsage(this.prisma, id),
      this.prisma.campaignEntry.findMany({ where: { brandId: id }, include: { campaign: { select: { name: true, slug: true, startsAt: true, endsAt: true } } }, orderBy: { joinedAt: 'desc' }, take: 20 }),
      this.prisma.brandProductReview.aggregate({ where: { brandId: id }, _count: { _all: true }, _avg: { rating: true } }),
      this.prisma.brandUgc.count({ where: { brandId: id, status: 'PENDING' } }),
      this.prisma.brandThread.count({ where: { brandId: id, status: 'OPEN' } }),
      this.prisma.brandUpdate.count({ where: { brandId: id, isDeleted: false } }),
      this.prisma.creatorCollab.groupBy({ by: ['status'], where: { brandId: id }, _count: { _all: true } }),
    ]);
    return {
      plan: { id: plan.id, name: plan.name, stored: b.plan, until: plan.id === 'FREE' ? null : b.planUntil?.toISOString() ?? null, limits: plan.limits, usage },
      plans: PLANS.map((p) => ({ id: p.id, name: p.name, price: p.price, limits: p.limits })),
      gst: { gstin: b.gstin ?? '', verified: Boolean(b.gstin && b.gstVerifiedAt), verifiedAt: b.gstVerifiedAt?.toISOString() ?? null },
      notifyPrefs: notifyPrefsOf(b.notifyPrefs),
      store: { published: Boolean(b.storeLayout), publishedAt: b.storePublishedAt?.toISOString() ?? null, hasDraft: Boolean(b.storeDraft), previousSlugs: b.previousSlugs },
      campaigns: campaigns.map((c) => ({ name: c.campaign.name, slug: c.campaign.slug, startsAt: c.campaign.startsAt.toISOString(), endsAt: c.campaign.endsAt.toISOString(), pieces: c.productIds.length, joinedAt: c.joinedAt.toISOString() })),
      community: {
        reviews: reviews._count._all,
        rating: reviews._avg.rating ? Math.round(reviews._avg.rating * 10) / 10 : null,
        pendingLooks,
        openThreads,
        updates,
        collabs: Object.fromEntries(collabs.map((c) => [c.status, c._count._all])),
      },
    };
  }

  /**
   * Comps or corrects a plan without a payment: sets the plan for `days` from now, or back to Free.
   * Credits are not touched (use the credits control for that).
   */
  async setPlan(id: string, dto: SetPlanDto, admin: AuthenticatedAdmin) {
    const b = await this.brand(id, admin);
    const plan = findPlan(dto.plan);
    if (!plan) throw new BadRequestException('Unknown plan.');
    if (plan.id !== 'FREE' && !dto.days) throw new BadRequestException('Say how many days the plan runs for.');
    const planUntil = plan.id === 'FREE' ? null : new Date(Date.now() + (dto.days as number) * DAY);
    await this.prisma.brand.update({ where: { id }, data: { plan: plan.id, planUntil } });
    await this.audit.log({
      adminUserId: admin.adminUserId,
      action: 'BRAND_PLAN_SET',
      entityType: 'Brand',
      entityId: id,
      metadata: { from: b.plan, fromUntil: b.planUntil?.toISOString() ?? null, to: plan.id, until: planUntil?.toISOString() ?? null, reason: dto.reason.trim() },
    });
    return { plan: plan.id, until: planUntil?.toISOString() ?? null };
  }

  /** Staff checked the GSTIN on the GST portal. The badge shows to shoppers once verified. */
  async decideGst(id: string, dto: GstDecisionDto, admin: AuthenticatedAdmin) {
    const b = await this.brand(id, admin);
    if (dto.verified && !b.gstin) throw new BadRequestException('This brand has not added a GST number yet.');
    await this.prisma.brand.update({ where: { id }, data: dto.verified ? { gstVerifiedAt: new Date(), gstVerifiedBy: admin.adminUserId } : { gstVerifiedAt: null, gstVerifiedBy: null } });
    await this.audit.log({ adminUserId: admin.adminUserId, action: dto.verified ? 'BRAND_GST_VERIFIED' : 'BRAND_GST_UNVERIFIED', entityType: 'Brand', entityId: id, metadata: { gstin: b.gstin, note: dto.note?.trim() || null } });
    return { gstin: b.gstin, verified: dto.verified };
  }

  async payments(id: string, admin: AuthenticatedAdmin) {
    await this.brand(id, admin);
    return this.billing.history(id);
  }

  async invoice(id: string, paymentId: string, admin: AuthenticatedAdmin) {
    await this.brand(id, admin);
    return this.billing.invoice(id, paymentId);
  }

  /** Gives a brand without a login its owner account and emails them a set-password link. */
  async inviteOwner(id: string, dto: InviteOwnerDto, admin: AuthenticatedAdmin) {
    await this.brand(id, admin);
    const owner = await this.brandAuth.inviteOwner(id, dto);
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_OWNER_INVITED', entityType: 'Brand', entityId: id, metadata: { email: owner.email } });
    return owner;
  }

  // ── Community moderation ───────────────────────────────────────────────

  async community(id: string, admin: AuthenticatedAdmin) {
    await this.brand(id, admin);
    const [reviews, looks, updates] = await Promise.all([
      this.prisma.brandProductReview.findMany({ where: { brandId: id }, orderBy: { createdAt: 'desc' }, take: 30, include: { user: { select: { username: true } }, product: { select: { title: true } } } }),
      this.prisma.brandUgc.findMany({ where: { brandId: id }, orderBy: { createdAt: 'desc' }, take: 30, include: { user: { select: { username: true } } } }),
      this.prisma.brandUpdate.findMany({ where: { brandId: id, isDeleted: false }, orderBy: { publishedAt: 'desc' }, take: 30 }),
    ]);
    return {
      reviews: reviews.map((r) => ({ id: r.id, rating: r.rating, body: r.body, brandReply: r.brandReply, product: r.product.title, user: r.user.username, createdAt: r.createdAt.toISOString() })),
      looks: looks.map((l) => ({ id: l.id, imageUrl: l.imageUrl, caption: l.caption, status: l.status, user: l.user.username, createdAt: l.createdAt.toISOString() })),
      updates: updates.map((u) => ({ id: u.id, kind: u.kind, body: u.body, media: u.media, pollOptions: u.pollOptions, publishedAt: u.publishedAt.toISOString() })),
    };
  }

  async removeReview(id: string, reviewId: string, reason: string | undefined, admin: AuthenticatedAdmin) {
    await this.brand(id, admin);
    const { count } = await this.prisma.brandProductReview.deleteMany({ where: { id: reviewId, brandId: id } });
    if (!count) throw new NotFoundException('Review not found');
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_REVIEW_REMOVED', entityType: 'Brand', entityId: id, metadata: { reviewId, reason: reason?.trim() || null } });
    return { id: reviewId, removed: true };
  }

  /** Overrides the brand's decision on a shopper's look, e.g. to take down an approved one. */
  async decideLook(id: string, lookId: string, dto: LookDecisionDto, admin: AuthenticatedAdmin) {
    await this.brand(id, admin);
    const { count } = await this.prisma.brandUgc.updateMany({ where: { id: lookId, brandId: id }, data: { status: dto.status, decidedAt: new Date() } });
    if (!count) throw new NotFoundException('Look not found');
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_LOOK_MODERATED', entityType: 'Brand', entityId: id, metadata: { lookId, status: dto.status } });
    return { id: lookId, status: dto.status };
  }

  async removeUpdate(id: string, updateId: string, reason: string | undefined, admin: AuthenticatedAdmin) {
    await this.brand(id, admin);
    const { count } = await this.prisma.brandUpdate.updateMany({ where: { id: updateId, brandId: id, isDeleted: false }, data: { isDeleted: true } });
    if (!count) throw new NotFoundException('Update not found');
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_UPDATE_REMOVED', entityType: 'Brand', entityId: id, metadata: { updateId, reason: reason?.trim() || null } });
    return { id: updateId, removed: true };
  }

  // ── Rankings ───────────────────────────────────────────────────────────

  /** The month's standings with each brand's name, for the leaderboard page. Live for the current month. */
  async rankings(month: string | undefined, admin: AuthenticatedAdmin) {
    const key = month && /^\d{4}-\d{2}$/.test(month) ? month : monthKey();
    const standings = await this.ranking.standings(key);
    const scoped = await this.access.scopedBrandIds(admin);
    const visible = scoped ? standings.filter((s) => scoped.includes(s.brandId)) : standings;
    const brands = await this.prisma.brand.findMany({ where: { id: { in: visible.map((s) => s.brandId) } }, select: { id: true, name: true, slug: true, logoUrl: true, plan: true, planUntil: true } });
    const byId = new Map(brands.map((b) => [b.id, b]));
    return {
      month: key,
      final: key !== monthKey(),
      total: standings.length,
      rows: visible.map((s) => {
        const b = byId.get(s.brandId);
        return { ...s, name: b?.name ?? 'Unknown brand', slug: b?.slug ?? '', logoUrl: b?.logoUrl ?? null, plan: b ? activePlan(b).id : 'FREE' };
      }),
    };
  }

  // ── One catalog across every brand ─────────────────────────────────────

  async catalog(q: AdminCatalogQueryDto, admin: AuthenticatedAdmin) {
    const page = q.page ?? 1;
    const limit = Math.min(q.limit ?? 24, 100);
    const scoped = await this.access.scopedBrandIds(admin);
    if (q.brandId && scoped && !scoped.includes(q.brandId)) return { items: [], meta: buildPaginationMeta(0, page, limit), facets: { categories: [] } };
    const search = q.search?.trim();
    const where: Prisma.BrandProductWhereInput = {
      brand: { isDeleted: false },
      ...(q.brandId ? { brandId: q.brandId } : scoped ? { brandId: { in: scoped } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.category ? { category: q.category } : {}),
      ...(q.drapeReady === 'yes' ? { isDrapeReady: true } : q.drapeReady === 'no' ? { isDrapeReady: false } : {}),
      ...(q.stock === 'out' ? { stock: 0 } : q.stock === 'low' ? { stock: { gt: 0, lte: 3 } } : {}),
      ...(search
        ? { OR: [{ title: { contains: search, mode: 'insensitive' } }, { sku: { contains: search, mode: 'insensitive' } }, { tags: { has: search.toLowerCase() } }, { brand: { name: { contains: search, mode: 'insensitive' } } }] }
        : {}),
    };
    const orderBy: Prisma.BrandProductOrderByWithRelationInput[] =
      q.sort === 'drapes' ? [{ drapesCount: 'desc' }, { id: 'desc' }] : q.sort === 'clicks' ? [{ clicksCount: 'desc' }, { id: 'desc' }] : q.sort === 'price' ? [{ price: 'desc' }, { id: 'desc' }] : [{ createdAt: 'desc' }, { id: 'desc' }];
    const [rows, total, categories] = await Promise.all([
      this.prisma.brandProduct.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: { brand: { select: { id: true, name: true, slug: true, status: true } }, _count: { select: { variants: true, reviews: true } } },
      }),
      this.prisma.brandProduct.count({ where }),
      this.prisma.brandProduct.groupBy({ by: ['category'], where: { brand: { isDeleted: false }, ...(scoped ? { brandId: { in: scoped } } : {}) }, _count: { _all: true }, orderBy: { category: 'asc' } }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        title: r.title,
        sku: r.sku,
        image: r.images[0] ?? null,
        price: r.price,
        originalPrice: r.originalPrice,
        category: r.category,
        occasions: r.occasions,
        stock: r.stock,
        status: r.status,
        isDrapeReady: r.isDrapeReady,
        drapeIssues: r.drapeIssues,
        drapes: r.drapesCount,
        clicks: r.clicksCount,
        variants: r._count.variants,
        reviews: r._count.reviews,
        collection: r.collection,
        externalSource: r.externalSource,
        buyUrl: r.buyUrl,
        createdAt: r.createdAt.toISOString(),
        publishedAt: r.publishedAt?.toISOString() ?? null,
        brand: r.brand,
      })),
      meta: buildPaginationMeta(total, page, limit),
      facets: { categories: categories.map((c) => ({ category: c.category, count: c._count._all })) },
    };
  }

  /** Hides a live piece from shoppers (back to draft) or puts a hidden one back. Audit-logged with the reason. */
  async setCatalogStatus(itemId: string, dto: AdminCatalogStatusDto, admin: AuthenticatedAdmin) {
    const item = await this.prisma.brandProduct.findUnique({ where: { id: itemId }, select: { id: true, brandId: true, status: true, publishedAt: true, title: true } });
    if (!item) throw new NotFoundException('Piece not found');
    await this.access.assertAccess(admin, item.brandId);
    const status = dto.status === 'PUBLISHED' ? ContentStatus.PUBLISHED : ContentStatus.DRAFT;
    await this.prisma.brandProduct.update({ where: { id: itemId }, data: { status, ...(status === ContentStatus.PUBLISHED && !item.publishedAt ? { publishedAt: new Date() } : {}) } });
    await this.audit.log({ adminUserId: admin.adminUserId, action: status === ContentStatus.PUBLISHED ? 'BRAND_PIECE_RESTORED' : 'BRAND_PIECE_HIDDEN', entityType: 'Brand', entityId: item.brandId, metadata: { itemId, title: item.title, from: item.status, reason: dto.reason?.trim() || null } });
    return { id: itemId, status };
  }
}
