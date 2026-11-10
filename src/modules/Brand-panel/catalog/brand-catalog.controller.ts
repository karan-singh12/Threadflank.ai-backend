import { Controller, Get, Post, Patch, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BrandCatalogService } from './brand-catalog.service';
import { CreateGarmentDto, UpdateGarmentDto } from '../dto/brand-common.dto';

@ApiTags('Brand Panel — Catalog & Garment Inventory')
@Controller('brand/catalog')
export class BrandCatalogController {
  constructor(private readonly catalogService: BrandCatalogService) {}

  @Get()
  @ApiOperation({ summary: 'List all luxury garments in brand inventory' })
  async findAll() {
    const data = await this.catalogService.findAll();
    return {
      message: 'Catalog fetched successfully',
      data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a single garment' })
  async findOne(@Param('id') id: string) {
    const data = await this.catalogService.findOne(id);
    return {
      message: 'Garment details fetched successfully',
      data,
    };
  }

  @Post()
  @ApiOperation({ summary: 'Add a new luxury garment with D2C Buy URL' })
  async create(@Body() dto: CreateGarmentDto) {
    const data = await this.catalogService.create(dto);
    return {
      message: 'Garment added to catalog successfully',
      data,
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update garment pricing, stock or Buy link' })
  async update(@Param('id') id: string, @Body() dto: UpdateGarmentDto) {
    const data = await this.catalogService.update(id, dto);
    return {
      message: 'Garment updated successfully',
      data,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a garment from catalog' })
  async remove(@Param('id') id: string) {
    const data = await this.catalogService.remove(id);
    return {
      message: 'Garment removed from catalog',
      data,
    };
  }
}

