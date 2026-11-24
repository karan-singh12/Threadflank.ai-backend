import { Controller, Get, Post, Body, HttpCode, HttpStatus, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandAnalyticsService, DEFAULT_PERIOD_DAYS } from './brand-analytics.service';

/** 7, 30 or 90 days; anything else falls back to 30. */
const periodOf = (v?: string) => ([7, 30, 90].includes(Number(v)) ? Number(v) : DEFAULT_PERIOD_DAYS);
import { TrackClickDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';
import { BrandDashboardService } from './brand-dashboard.service';
import { BrandInsightsService } from './brand-insights.service';

@ApiTags('Brand Panel — Analytics & Conversions')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/analytics')
export class BrandAnalyticsController {
  constructor(
    private readonly analyticsService: BrandAnalyticsService,
    private readonly dashboard: BrandDashboardService,
    private readonly insights: BrandInsightsService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'KPI metrics (views, try-ons, saves, click-outs, conversion %)' })
  async getOverview(@CurrentBrand() brand: AuthenticatedBrand, @Query('days') days?: string) {
    return { message: 'Analytics overview fetched successfully', data: await this.analyticsService.getOverview(brand.brandId, periodOf(days)) };
  }

  @Get('series')
  @ApiOperation({ summary: 'Per-day views, try-ons, saves, shares and click-outs for charts (days = 7, 30 or 90)' })
  async getSeries(@CurrentBrand() brand: AuthenticatedBrand, @Query('days') days?: string) {
    return { message: 'Analytics series fetched successfully', data: await this.analyticsService.getSeries(brand.brandId, periodOf(days)) };
  }

  @Get('top-pieces')
  @ApiOperation({ summary: 'The pieces shoppers reached for most, ranked like the brand score (days = 7, 30 or 90)' })
  async getTopPieces(@CurrentBrand() brand: AuthenticatedBrand, @Query('days') days?: string, @Query('limit') limit?: string) {
    const n = Math.min(Math.max(parseInt(limit ?? '5', 10) || 5, 1), 25);
    return { message: 'Top pieces fetched successfully', data: await this.analyticsService.getTopPieces(brand.brandId, periodOf(days), n) };
  }

  @Get('categories')
  @ApiOperation({ summary: 'Views, try-ons, saves, shares and buy clicks by piece category (days = 7, 30 or 90)' })
  async getCategories(@CurrentBrand() brand: AuthenticatedBrand, @Query('days') days?: string) {
    return { message: 'Category breakdown fetched successfully', data: await this.analyticsService.getCategories(brand.brandId, periodOf(days)) };
  }

  @Get('ranking')
  @ApiOperation({ summary: "This month's rank and score, the points to the next place, last month, and tips" })
  async ranking(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Ranking fetched', data: await this.dashboard.ranking(brand.brandId) };
  }

  @Get('alerts')
  @ApiOperation({ summary: 'What needs attention: launches due, trending pieces, rank change, stock, photos, buy links' })
  async alerts(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Alerts fetched', data: await this.dashboard.alerts(brand.brandId) };
  }

  @Get('missed-pieces')
  @ApiOperation({ summary: 'Pieces tried on a lot but rarely clicked through (days = 7, 30 or 90)' })
  async missed(@CurrentBrand() brand: AuthenticatedBrand, @Query('days') days?: string) {
    return { message: 'Missed pieces fetched', data: await this.dashboard.missed(brand.brandId, periodOf(days)) };
  }

  @Get('insights')
  @ApiOperation({ summary: 'Deeper insights: piece conversion, occasion demand, wardrobe gaps, trends, audience, benchmark, search terms' })
  async deep(@CurrentBrand() brand: AuthenticatedBrand, @Query('days') days?: string) {
    const d = periodOf(days);
    const [conversion, occasions, gaps, trends, audience, benchmark, searches] = await Promise.all([
      this.insights.conversion(brand.brandId, d),
      this.insights.occasionDemand(),
      this.insights.wardrobeGaps(),
      this.insights.trends(),
      this.insights.audience(brand.brandId),
      this.insights.benchmark(brand.brandId),
      this.insights.searchTerms(brand.brandId, d),
    ]);
    return { message: 'Insights fetched', data: { conversion, occasions, gaps, trends, audience, benchmark, searches } };
  }

  @Post('track-click')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record an outbound Buy Now click' })
  async trackClick(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: TrackClickDto) {
    return { message: 'Outbound click recorded', data: await this.analyticsService.trackOutboundClick(brand.brandId, dto) };
  }
}
