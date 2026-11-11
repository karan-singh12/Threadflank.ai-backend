import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BrandAnalyticsService } from './brand-analytics.service';
import { TrackClickDto } from '../dto/brand-common.dto';

@ApiTags('Brand Panel — Analytics & Conversions')
@Controller('brand/analytics')
export class BrandAnalyticsController {
  constructor(private readonly analyticsService: BrandAnalyticsService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get KPI metrics (Views, Drapes, Saves, Click-outs, Conversion %)' })
  async getOverview() {
    const data = await this.analyticsService.getOverview();
    return {
      message: 'Analytics overview fetched successfully',
      data,
    };
  }

  @Post('track-click')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record an outbound Buy Now click conversion' })
  async trackClick(@Body() dto: TrackClickDto) {
    const data = await this.analyticsService.trackOutboundClick(dto);
    return {
      message: 'Outbound click recorded',
      data,
    };
  }
}

