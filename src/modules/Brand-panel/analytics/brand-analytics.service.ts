import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TrackClickDto } from '../dto/brand-common.dto';
import { BrandCatalogService } from '../catalog/brand-catalog.service';

/** `changePct` is null until there is a previous period to compare against. */
export interface MetricDto {
  total: number;
  changePct: number | null;
}

export interface MetricSummaryDto {
  storeViews: MetricDto;
  totalDrapes: MetricDto;
  saves: MetricDto;
  shares: MetricDto;
  clickOuts: MetricDto;
  conversionRate: MetricDto;
}

const metric = (total: number): MetricDto => ({ total, changePct: null });

@Injectable()
export class BrandAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalogService: BrandCatalogService,
  ) {}

  /**
   * Only what is recorded: widget sessions (real, in the database) and buy clicks (in memory until
   * the catalog is persisted). Saves and shares have no source yet and report 0.
   */
  async getOverview(brandId: string): Promise<MetricSummaryDto> {
    const [sessions, successful] = await Promise.all([
      this.prisma.brandWidgetSession.count({ where: { brandId } }),
      this.prisma.brandWidgetSession.count({ where: { brandId, success: true } }),
    ]);
    const { clicks } = this.catalogService.totals(brandId);
    const conversion = successful > 0 ? Number(((clicks / successful) * 100).toFixed(1)) : 0;

    return {
      storeViews: metric(sessions),
      totalDrapes: metric(successful),
      saves: metric(0),
      shares: metric(0),
      clickOuts: metric(clicks),
      conversionRate: metric(conversion),
    };
  }

  async trackOutboundClick(brandId: string, dto: TrackClickDto) {
    const counted = this.catalogService.incrementClick(brandId, dto.productId);
    return { success: counted, productId: dto.productId };
  }
}
