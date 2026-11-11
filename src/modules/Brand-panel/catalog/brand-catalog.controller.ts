import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandCatalogService } from './brand-catalog.service';
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
  @ApiOperation({ summary: "List the brand's garments" })
  async findAll(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Catalog fetched successfully', data: await this.catalogService.findAll(brand.brandId) };
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
