import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';

const DAY_MS = 86_400_000;
const newKey = () => `tfw_${randomBytes(18).toString('base64url')}`;

/** Only https origins (http://localhost is allowed for testing); no wildcards, no paths. */
export function toOrigin(value: string): string | null {
  try {
    const u = new URL(value.trim());
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** A brand's own view of its try-on widget: key, allowed storefronts and how much it is used. */
@Injectable()
export class BrandWidgetService {
  constructor(private readonly prisma: PrismaService) {}

  private async brand(brandId: string) {
    const brand = await this.prisma.brand.findFirst({ where: { id: brandId, isDeleted: false } });
    if (!brand) throw new NotFoundException('Brand not found.');
    return brand;
  }

  /** The key is created the first time a brand opens this screen, so there is always something to copy. */
  async get(brandId: string) {
    let brand = await this.brand(brandId);
    if (!brand.widgetKey) brand = await this.prisma.brand.update({ where: { id: brandId }, data: { widgetKey: newKey() } });

    const since = new Date(Date.now() - 30 * DAY_MS);
    const [total, succeeded, byOrigin] = await Promise.all([
      this.prisma.brandWidgetSession.count({ where: { brandId, createdAt: { gte: since } } }),
      this.prisma.brandWidgetSession.count({ where: { brandId, createdAt: { gte: since }, success: true } }),
      this.prisma.brandWidgetSession.groupBy({ by: ['origin'], where: { brandId, createdAt: { gte: since }, origin: { not: null } }, _count: { _all: true }, orderBy: { _count: { origin: 'desc' } }, take: 5 }),
    ]);
    return {
      key: brand.widgetKey,
      // Live only once Threadflank has approved the brand and has not switched the widget off.
      live: brand.widgetEnabled && brand.status === 'ACTIVE',
      status: brand.status,
      domains: (brand.widgetDomains as string[] | null) ?? [],
      last30Days: { sessions: total, succeeded },
      topOrigins: byOrigin.map((o) => ({ origin: o.origin as string, sessions: o._count._all })),
    };
  }

  async setDomains(brandId: string, domains: string[]) {
    const origins = domains.map((d) => toOrigin(d));
    if (origins.some((o) => !o)) throw new BadRequestException('Each site must be a full https:// address, like https://shop.yourbrand.com');
    await this.brand(brandId);
    await this.prisma.brand.update({ where: { id: brandId }, data: { widgetDomains: [...new Set(origins as string[])] } });
    return this.get(brandId);
  }

  /** The old key stops working at once, so any embed using it must be updated. */
  async rotateKey(brandId: string) {
    await this.brand(brandId);
    await this.prisma.brand.update({ where: { id: brandId }, data: { widgetKey: newKey() } });
    return this.get(brandId);
  }
}
