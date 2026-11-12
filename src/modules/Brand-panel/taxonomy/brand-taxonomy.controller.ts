import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BrandAuthGuard } from '../auth/brand-auth.guard';
import { TaxonomyService } from './taxonomy.service';

/** The category and occasion choices a brand sees when adding a piece. Admins manage them. */
@ApiTags('Brand Panel — Categories and occasions')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/taxonomy')
export class BrandTaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get()
  @ApiOperation({ summary: 'Active categories and occasions, in the admin\'s order' })
  async get() {
    const [categories, occasions] = await Promise.all([this.taxonomy.list('CATEGORY'), this.taxonomy.list('OCCASION')]);
    return { message: 'Fetched', data: { categories: categories.map((c) => c.name), occasions: occasions.map((o) => o.name) } };
  }
}
