import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BrandAccessService } from '../brands/brand-access.service';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { SdkService } from '../../sdk/sdk.service';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface WidgetSessionInput {
  key: string;
  origin?: string;
  productUrl?: string;
  success?: boolean;
  model?: string;
  latencyMs?: number;
  errorMessage?: string;
  outputUrl?: string;
}

const originOf = (value?: string) => {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/**
 * Embeddable D2C try-on widget (PRD §4.7, future_scope #9): brands get a
 * public key, drop a <script> on their product pages, and every session is
 * counted here and in the AI usage log. No billing — sessions are only metered.
 */
@Injectable()
export class WidgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly brandAccess: BrandAccessService,
    private readonly audit: AuditLogService,
    private readonly sdk: SdkService,
  ) {}

  // ─── Admin ─────────────────────────────────────────────────────────────────

  async adminGet(brandId: string, admin: AuthenticatedAdmin) {
    await this.brandAccess.assertAccess(admin, brandId);
    const brand = await this.prisma.brand.findFirst({ where: { id: brandId, isDeleted: false } });
    if (!brand) throw new NotFoundException('Brand not found');

    const since = new Date(Date.now() - 30 * DAY_MS);
    const sessions = await this.prisma.brandWidgetSession.findMany({ where: { brandId, createdAt: { gte: since } }, select: { createdAt: true, success: true, origin: true } });
    const daily = new Map<string, { date: string; sessions: number; succeeded: number }>();
    for (let d = 29; d >= 0; d--) {
      const key = new Date(Date.now() - d * DAY_MS).toISOString().slice(0, 10);
      daily.set(key, { date: key, sessions: 0, succeeded: 0 });
    }
    const origins = new Map<string, number>();
    for (const s of sessions) {
      const row = daily.get(s.createdAt.toISOString().slice(0, 10));
      if (row) {
        row.sessions += 1;
        if (s.success) row.succeeded += 1;
      }
      if (s.origin) origins.set(s.origin, (origins.get(s.origin) ?? 0) + 1);
    }
    const ok = sessions.filter((s) => s.success).length;
    return {
      brandId,
      brandName: brand.name,
      widgetKey: brand.widgetKey,
      widgetEnabled: brand.widgetEnabled,
      widgetDomains: (brand.widgetDomains as string[] | null) ?? [],
      sessions30d: sessions.length,
      successRate30d: sessions.length ? Math.round((ok / sessions.length) * 1000) / 10 : null,
      daily: [...daily.values()],
      origins: [...origins.entries()].map(([origin, count]) => ({ origin, count })).sort((a, b) => b.count - a.count),
    };
  }

  async rotateKey(brandId: string, admin: AuthenticatedAdmin) {
    await this.brandAccess.assertAccess(admin, brandId);
    const key = `tfw_${randomBytes(18).toString('base64url')}`;
    await this.prisma.brand.update({ where: { id: brandId }, data: { widgetKey: key } });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'WIDGET_KEY_ROTATED', entityType: 'Brand', entityId: brandId });
    return this.adminGet(brandId, admin);
  }

  async update(brandId: string, input: { enabled?: boolean; domains?: string[] }, admin: AuthenticatedAdmin) {
    await this.brandAccess.assertAccess(admin, brandId);
    const data: Record<string, unknown> = {};
    if (input.enabled !== undefined) data.widgetEnabled = Boolean(input.enabled);
    if (input.domains !== undefined) {
      if (!Array.isArray(input.domains)) throw new BadRequestException('domains must be a list');
      const origins = input.domains.map((d) => originOf(String(d).trim()));
      if (origins.some((o) => !o)) throw new BadRequestException('Each domain must be a full URL, e.g. https://shop.example.com');
      data.widgetDomains = [...new Set(origins)];
    }
    const brand = await this.prisma.brand.findUnique({ where: { id: brandId } });
    if (data.widgetEnabled && !brand?.widgetKey) data.widgetKey = `tfw_${randomBytes(18).toString('base64url')}`;
    await this.prisma.brand.update({ where: { id: brandId }, data });
    await this.audit.log({ adminUserId: admin.adminUserId, action: 'WIDGET_UPDATED', entityType: 'Brand', entityId: brandId, metadata: input as any });
    return this.adminGet(brandId, admin);
  }

  // ─── Public (storefront embed) ─────────────────────────────────────────────

  private async brandForKey(key: string, origin?: string) {
    if (!key) throw new BadRequestException('Missing widget key');
    const brand = await this.prisma.brand.findFirst({ where: { widgetKey: key, isDeleted: false } });
    if (!brand || !brand.widgetEnabled || brand.status !== 'ACTIVE') throw new ForbiddenException('This try-on widget is not active');
    const allowed = (brand.widgetDomains as string[] | null) ?? [];
    const from = originOf(origin);
    // With no allow-list configured the widget works anywhere (handy while testing).
    if (allowed.length && (!from || !allowed.includes(from))) throw new ForbiddenException('This site is not allowed to use the widget');
    return brand;
  }

  async config(key: string, origin?: string) {
    const brand = await this.brandForKey(key, origin);
    return { brand: { id: brand.id, name: brand.name, logoUrl: brand.logoUrl, isVerified: brand.isVerified } };
  }

  async recordSession(input: WidgetSessionInput) {
    const brand = await this.brandForKey(input.key, input.origin);
    await this.prisma.brandWidgetSession.create({
      data: {
        brandId: brand.id,
        origin: originOf(input.origin),
        productUrl: input.productUrl?.slice(0, 1000) ?? null,
        success: Boolean(input.success),
      },
    });
    if (input.model) {
      await this.sdk.logExternalCall({
        provider: 'replicate',
        model: input.model.slice(0, 120),
        taskType: 'widget-try-on',
        latencyMs: Math.max(0, Math.round(Number(input.latencyMs) || 0)),
        success: Boolean(input.success),
        errorMessage: input.errorMessage,
        outputUrl: input.outputUrl,
        metadata: { brandId: brand.id, brandName: brand.name, origin: originOf(input.origin) },
      });
    }
    return { recorded: true };
  }
}
