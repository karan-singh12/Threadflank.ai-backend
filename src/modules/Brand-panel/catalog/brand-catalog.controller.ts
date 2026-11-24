import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandCatalogService } from './brand-catalog.service';
import { BulkCatalogDto, CatalogPageQueryDto, ImportCatalogDto, StoreSyncDto } from './catalog-page.dto';
import { StoreSyncService } from './store-sync.service';
import { CreateGarmentDto, UpdateGarmentDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';
import { CatalogAiService } from './catalog-ai.service';
import { AutoTagDto, CheckPhotosDto, DescribeDto } from './catalog-ai.dto';

@ApiTags('Brand Panel — Catalog & Garment Inventory')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/catalog')
export class BrandCatalogController {
  constructor(
    private readonly catalogService: BrandCatalogService,
    private readonly catalogAi: CatalogAiService,
    private readonly storeSync: StoreSyncService,
  ) {}

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

  @Post('import-store')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Import or re-sync up to 500 pieces from a Shopify or WooCommerce store (public product feed, no keys needed)' })
  async importStore(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: StoreSyncDto) {
    return { message: 'Store synced', data: await this.storeSync.sync(brand.brandId, dto) };
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Publish, hide, delete or move up to 500 garments to a collection' })
  async bulk(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: BulkCatalogDto) {
    return { message: 'Garments updated', data: await this.catalogService.bulk(brand.brandId, dto) };
  }

  @Post('auto-tag')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Suggest category, occasions, colours, fabric, pattern and tags from a photo (1 credit, charged only when it works)' })
  async autoTag(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: AutoTagDto) {
    return { message: 'Tags suggested', data: await this.catalogAi.autoTag(brand.brandId, dto) };
  }

  @Post('describe')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Write a title, description and SEO keywords in English or Hinglish (2 credits, charged only when it works)' })
  async describe(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: DescribeDto) {
    return { message: 'Listing written', data: await this.catalogAi.describe(brand.brandId, dto) };
  }

  @Post('photo-check')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 6, ttl: 60_000 } })
  @ApiOperation({ summary: "Check up to 25 pieces' photos for try-on" })
  async checkPhotos(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: CheckPhotosDto) {
    return { message: 'Photos checked', data: await this.catalogAi.checkMany(brand.brandId, dto.ids) };
  }

  @Post(':id/photo-check')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Check whether a piece's main photo works for try-on (free)" })
  async checkPhoto(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Photo checked', data: await this.catalogAi.drapeCheck(brand.brandId, id) };
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
