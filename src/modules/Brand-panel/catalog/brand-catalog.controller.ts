import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandCatalogService } from './brand-catalog.service';
import { BulkCatalogDto, CatalogPageQueryDto, ImportCatalogDto } from './catalog-page.dto';
import { CreateGarmentDto, UpdateGarmentDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';

@ApiTags('Brand Panel — Catalog & Garment Inventory')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/catalog')
export class BrandCatalogController {
  constructor(private readonly catalogService: BrandCatalogService) {}

  @Get()
  @ApiOperation({ summary: "List the brand's garments (send limit / cursor / q / status for pages)" })
  async findAll(@CurrentBrand() brand: AuthenticatedBrand, @Query() q: CatalogPageQueryDto) {
    // No paging parameters: the whole list (capped), as older clients expect. Otherwise a cursor page.
    const paged = Object.values(q).some((v) => v !== undefined);
    if (!paged) return { message: 'Catalog fetched successfully', data: await this.catalogService.findAll(brand.brandId) };
    const { items, nextCursor, total } = await this.catalogService.findPage(brand.brandId, q);
    return { message: 'Catalog fetched successfully', data: items, meta: { limit: q.limit ?? 24, total, nextCursor, hasMore: nextCursor !== null } };
  }

  @Get('facets')
  @ApiOperation({ summary: 'Counts for the filter bar: categories, collections, status, stock' })
  async facets(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Catalog facets fetched successfully', data: await this.catalogService.facets(brand.brandId) };
  }

  @Post('import')
  @ApiOperation({ summary: 'Import up to 500 garments at once (CSV rows). Reports each bad row instead of failing the file' })
  async import(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: ImportCatalogDto) {
    return { message: 'Import finished', data: await this.catalogService.importItems(brand.brandId, dto) };
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Publish, hide, delete or move up to 500 garments to a collection' })
  async bulk(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: BulkCatalogDto) {
    return { message: 'Garments updated', data: await this.catalogService.bulk(brand.brandId, dto) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a single garment' })
  async findOne(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Garment details fetched successfully', data: await this.catalogService.findOne(brand.brandId, id) };
  }

  @Post()
  @ApiOperation({ summary: 'Add a garment with its Buy URL' })
  async create(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: CreateGarmentDto) {
    return { message: 'Garment added to catalog successfully', data: await this.catalogService.create(brand.brandId, dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update garment pricing, stock or Buy link' })
  async update(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string, @Body() dto: UpdateGarmentDto) {
    return { message: 'Garment updated successfully', data: await this.catalogService.update(brand.brandId, id, dto) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a garment from the catalog' })
  async remove(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Garment removed from catalog', data: await this.catalogService.remove(brand.brandId, id) };
  }
}
