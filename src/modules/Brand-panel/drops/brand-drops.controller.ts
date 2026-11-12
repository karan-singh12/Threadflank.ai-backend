import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandDropsService } from './brand-drops.service';
import { CreateDropDto, UpdateDropDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';

@ApiTags('Brand Panel — Capsule Drops & Launches')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/drops')
export class BrandDropsController {
  constructor(private readonly dropsService: BrandDropsService) {}

  @Get()
  @ApiOperation({ summary: "List the brand's drops" })
  findAll(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Drops list fetched', data: this.dropsService.findAll(brand.brandId) };
  }

  @Post()
  @ApiOperation({ summary: 'Schedule a new capsule drop' })
  create(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: CreateDropDto) {
    return { message: 'Drop created and waitlist activated', data: this.dropsService.create(brand.brandId, dto) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a drop' })
  update(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string, @Body() dto: UpdateDropDto) {
    return { message: 'Drop updated', data: this.dropsService.update(brand.brandId, id, dto) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a drop' })
  remove(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Drop deleted', data: this.dropsService.remove(brand.brandId, id) };
  }
}
