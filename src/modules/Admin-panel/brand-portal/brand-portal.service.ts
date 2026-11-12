import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BrandStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../shared/audit/audit-log.service';
import { MailerService } from '../../../shared/mailer/mailer.service';
import { AppLogger } from '../../../shared/logger/logger.service';
import { buildPaginationMeta } from '../../../common/dto/pagination-query.dto';
import { AuthenticatedAdmin } from '../../../common/interfaces/admin-jwt-payload.interface';
import { BrandAccessService } from '../brands/brand-access.service';
import { BrandCatalogService } from '../../Brand-panel/catalog/brand-catalog.service';
import { BrandDropsService } from '../../Brand-panel/drops/brand-drops.service';
import { BrandBiddingService } from '../../Brand-panel/bidding/brand-bidding.service';
import { BrandAnalyticsService } from '../../Brand-panel/analytics/brand-analytics.service';
import { BrandPortalFilterDto, VerificationAction, VerificationDecisionDto } from './brand-portal.dto';

const ACCOUNT_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  emailVerified: true,
  lastLoginAt: true,
  createdAt: true,
} satisfies Prisma.BrandAccountSelect;

/** Admin-side management of brands that signed up through the brand panel. */
@Injectable()
export class BrandPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: BrandAccessService,
    private readonly audit: AuditLogService,
    private readonly mailer: MailerService,
    private readonly logger: AppLogger,
    private readonly catalog: BrandCatalogService,
    private readonly drops: BrandDropsService,
    private readonly bidding: BrandBiddingService,
    private readonly analytics: BrandAnalyticsService,
  ) {}

  /** Brands with a portal login, limited to the ones a BRAND_MANAGER is assigned to. */
  private async baseWhere(admin: AuthenticatedAdmin): Promise<Prisma.BrandWhereInput> {
    const scoped = await this.access.scopedBrandIds(admin);
    return { isDeleted: false, accounts: { some: {} }, ...(scoped ? { id: { in: scoped } } : {}) };
  }

  async overview(admin: AuthenticatedAdmin) {
    const base = await this.baseWhere(admin);
    const [pending, active, inactive, unverifiedEmails] = await Promise.all([
      this.prisma.brand.count({ where: { ...base, status: BrandStatus.PENDING } }),
      this.prisma.brand.count({ where: { ...base, status: BrandStatus.ACTIVE } }),
      this.prisma.brand.count({ where: { ...base, status: BrandStatus.INACTIVE } }),
      this.prisma.brandAccount.count({ where: { emailVerified: false, brand: base } }),
    ]);
    return { pending, active, inactive, total: pending + active + inactive, unverifiedEmails };
  }

  async list(filter: BrandPortalFilterDto, admin: AuthenticatedAdmin) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 20, 100);
    const where: Prisma.BrandWhereInput = await this.baseWhere(admin);
    if (filter.status) where.status = filter.status;
    if (filter.search) {
      where.OR = [
        { name: { contains: filter.search, mode: 'insensitive' } },
        { slug: { contains: filter.search, mode: 'insensitive' } },
        { accounts: { some: { email: { contains: filter.search, mode: 'insensitive' } } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.brand.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { accounts: { select: ACCOUNT_SELECT, orderBy: { createdAt: 'asc' } } },
      }),
      this.prisma.brand.count({ where }),
    ]);
    const brands = await Promise.all(rows.map(async (b) => ({ ...b, catalogCount: (await this.catalog.findAll(b.id)).length })));
    return { brands, meta: buildPaginationMeta(total, page, limit) };
  }

  private async getBrand(id: string, admin: AuthenticatedAdmin) {
    await this.access.assertAccess(admin, id);
    const brand = await this.prisma.brand.findFirst({
      where: { id, isDeleted: false },
      include: { accounts: { select: ACCOUNT_SELECT, orderBy: { createdAt: 'asc' } } },
    });
    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  async detail(id: string, admin: AuthenticatedAdmin) {
    const brand = await this.getBrand(id, admin);
    const [catalog, metrics] = await Promise.all([this.catalog.findAll(id), this.analytics.getOverview(id)]);
    return {
      brand,
      metrics,
      catalogCount: catalog.length,
      dropsCount: this.drops.findAll(id).length,
      bidsCount: this.bidding.findAll(id).filter((s) => s.yourCurrentBid !== undefined).length,
    };
  }

  async catalogOf(id: string, admin: AuthenticatedAdmin) {
    await this.getBrand(id, admin);
    return this.catalog.findAll(id);
  }

  async removeGarment(id: string, itemId: string, admin: AuthenticatedAdmin) {
    await this.getBrand(id, admin);
    const result = await this.catalog.remove(id, itemId);
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_CATALOG_ITEM_REMOVED', entityType: 'Brand', entityId: id, metadata: { itemId } });
    return result;
  }

  async dropsOf(id: string, admin: AuthenticatedAdmin) {
    await this.getBrand(id, admin);
    return this.drops.findAll(id);
  }

  async bidsOf(id: string, admin: AuthenticatedAdmin) {
    await this.getBrand(id, admin);
    return this.bidding.findAll(id);
  }

  async decide(id: string, dto: VerificationDecisionDto, admin: AuthenticatedAdmin) {
    const brand = await this.getBrand(id, admin);
    const reason = dto.reason?.trim();
    if (dto.action !== VerificationAction.APPROVE && !reason) {
      throw new BadRequestException('A reason is required to reject or suspend a brand.');
    }
    if (dto.action === VerificationAction.APPROVE && brand.status === BrandStatus.ACTIVE && brand.isVerified) {
      throw new BadRequestException('This brand is already approved.');
    }
    if (dto.action === VerificationAction.REJECT && brand.status !== BrandStatus.PENDING) {
      throw new BadRequestException('Only pending applications can be rejected. Use suspend for an active brand.');
    }
    if (dto.action === VerificationAction.SUSPEND && brand.status !== BrandStatus.ACTIVE) {
      throw new BadRequestException('Only active brands can be suspended.');
    }

    const approve = dto.action === VerificationAction.APPROVE;
    const social = (brand.socialLinks && typeof brand.socialLinks === 'object' ? brand.socialLinks : {}) as Record<string, unknown>;
    const updated = await this.prisma.brand.update({
      where: { id },
      data: {
        status: approve ? BrandStatus.ACTIVE : BrandStatus.INACTIVE,
        isVerified: approve,
        socialLinks: {
          ...social,
          verification: { decision: dto.action, reason: reason ?? null, reviewedAt: new Date().toISOString(), reviewedBy: admin.adminUserId },
        },
      },
    });

    if (!approve) {
      // Cut off sessions immediately; the brand can no longer refresh tokens.
      await this.prisma.brandRefreshToken.updateMany({
        where: { revokedAt: null, brandAccount: { brandId: id } },
        data: { revokedAt: new Date() },
      });
    }

    await this.audit.log({
      adminUserId: admin.adminUserId,
      action: `BRAND_${dto.action.toUpperCase()}`,
      entityType: 'Brand',
      entityId: id,
      metadata: { reason: reason ?? null, from: brand.status },
    });
    this.notify(brand.accounts.map((a) => a.email), brand.name, dto.action, reason);
    return updated;
  }

  async setAccountActive(id: string, accountId: string, isActive: boolean, admin: AuthenticatedAdmin) {
    await this.getBrand(id, admin);
    const account = await this.prisma.brandAccount.findFirst({ where: { id: accountId, brandId: id } });
    if (!account) throw new NotFoundException('Account not found');
    await this.prisma.brandAccount.update({ where: { id: accountId }, data: { isActive } });
    if (!isActive) {
      await this.prisma.brandRefreshToken.updateMany({ where: { brandAccountId: accountId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await this.audit.log({ adminUserId: admin.adminUserId, action: isActive ? 'BRAND_ACCOUNT_ENABLED' : 'BRAND_ACCOUNT_DISABLED', entityType: 'BrandAccount', entityId: accountId });
    return { id: accountId, isActive };
  }

  /** For when the verification email never arrives (e.g. SMTP down): staff confirm the inbox by hand. */
  async verifyAccountEmail(id: string, accountId: string, admin: AuthenticatedAdmin) {
    await this.getBrand(id, admin);
    const account = await this.prisma.brandAccount.findFirst({ where: { id: accountId, brandId: id } });
    if (!account) throw new NotFoundException('Account not found');
    await this.prisma.brandAccount.update({ where: { id: accountId }, data: { emailVerified: true } });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'BRAND_ACCOUNT_EMAIL_VERIFIED', entityType: 'BrandAccount', entityId: accountId });
    return { id: accountId, emailVerified: true };
  }

  /** Best effort: a mail failure must not undo the decision. */
  private notify(to: string[], brandName: string, action: VerificationAction, reason?: string) {
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    const name = esc(brandName);
    const copy = {
      [VerificationAction.APPROVE]: { subject: 'Your Threadflank brand is approved', body: `Good news: <b>${name}</b> has been approved and is now live on Threadflank.` },
      [VerificationAction.REJECT]: { subject: 'Your Threadflank brand application', body: `We could not approve <b>${name}</b> at this time.` },
      [VerificationAction.SUSPEND]: { subject: 'Your Threadflank brand was suspended', body: `<b>${name}</b> has been suspended.` },
    }[action];
    const html = `<p>${copy.body}</p>${reason ? `<p>Reason: ${esc(reason)}</p>` : ''}<p>Threadflank</p>`;
    for (const address of to) {
      this.mailer.send({ to: address, subject: copy.subject, html }).catch((err) => this.logger.warn('BrandPortal', `Brand decision email failed: ${err?.message ?? err}`));
    }
  }
}
