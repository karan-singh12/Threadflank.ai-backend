import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RankingService } from '../../Brand-panel/ranking/ranking.service';
import { isMonthKey, monthKey } from '../../Brand-panel/ranking/ranking-formula';

const clamp = (v: string | undefined, def: number, max: number) => Math.min(Math.max(parseInt(v ?? '', 10) || def, 1), max);

/**
 * The three monthly lists from the blueprint: Top Brands, Top Launches and Most Draped Outfits.
 * Earned only: sponsored placement is served separately (/spotlight) and always labelled.
 */
@ApiTags('Rankings (App)')
@Controller('rankings')
export class RankingsController {
  constructor(private readonly ranking: RankingService) {}

  @Get('brands')
  @ApiOperation({ summary: "Top brands of a month by score (month = YYYY-MM, default this month)" })
  async brands(@Query('month') month?: string, @Query('limit') limit?: string) {
    const m = month?.trim() || monthKey();
    if (!isMonthKey(m)) throw new BadRequestException('Month must look like 2026-11.');
    return { message: 'Top brands fetched', data: { month: m, items: await this.ranking.topBrands(m, clamp(limit, 20, 50)) } };
  }

  @Get('launches')
  @ApiOperation({ summary: 'Launches of the last 30 days, ranked by what shoppers did with them' })
  async launches(@Query('limit') limit?: string) {
    return { message: 'Top launches fetched', data: await this.ranking.topLaunches(clamp(limit, 10, 30)) };
  }

  @Get('draped')
  @ApiOperation({ summary: 'Most tried-on pieces of the last 7 or 30 days' })
  async draped(@Query('days') days?: string, @Query('limit') limit?: string) {
    const d = Number(days) === 30 ? 30 : 7;
    return { message: 'Most draped fetched', data: await this.ranking.mostDraped(d, clamp(limit, 20, 40)) };
  }
}
