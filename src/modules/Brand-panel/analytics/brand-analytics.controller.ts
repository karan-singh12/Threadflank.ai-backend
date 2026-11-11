import { Controller, Get, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandAnalyticsService } from './brand-analytics.service';
import { TrackClickDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';

@ApiTags('Brand Panel — Analytics & Conversions')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/analytics')
export class BrandAnalyticsController {
  constructor(private readonly analyticsService: BrandAnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'KPI metrics (views, try-ons, saves, click-outs, conversion %)' })
  async getOverview(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Analytics overview fetched successfully', data: await this.analyticsService.getOverview(brand.brandId) };
  }

  @Post('track-click')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record an outbound Buy Now click' })
  async trackClick(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: TrackClickDto) {
    return { message: 'Outbound click recorded', data: await this.analyticsService.trackOutboundClick(brand.brandId, dto) };
  }
}
