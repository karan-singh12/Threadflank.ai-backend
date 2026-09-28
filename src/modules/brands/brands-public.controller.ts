import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandsService } from './brands.service';
import { BrandFilterDto } from './dto/brand-filter.dto';
import { OptionalAuthGuard } from '../../common/guards/optional-auth.guard';
import { MESSAGES } from '../../common/constants/messages.constant';

/** App-facing read surface for the Discover feed's brand strip (PRD §4.5) — accessible publicly or with optional auth */
@ApiTags('Brands (App)')
@ApiBearerAuth()
@Controller('brands')
@UseGuards(OptionalAuthGuard)
export class BrandsPublicController {
  constructor(private readonly brandsService: BrandsService) {}

  @Get()
  @ApiOperation({ summary: 'List active partner brands' })
  async findAll(@Query() filter: BrandFilterDto) {
    const result = await this.brandsService.findAllPublic(filter);
    return { message: MESSAGES.brands.listFetched, data: result.brands, meta: result.meta };
  }
}
