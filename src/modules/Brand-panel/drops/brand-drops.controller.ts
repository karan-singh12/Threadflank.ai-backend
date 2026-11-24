import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandDropsService } from './brand-drops.service';
import { LaunchService } from './launch.service';
import { CreateDropDto, UpdateDropDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';

@ApiTags('Brand Panel — Capsule Drops & Launches')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/drops')
export class BrandDropsController {
  constructor(
    private readonly dropsService: BrandDropsService,
    private readonly launches: LaunchService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List the brand's drops" })
  async findAll(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Drops list fetched', data: await this.dropsService.findAll(brand.brandId) };
  }

  @Post()
  @ApiOperation({ summary: 'Schedule a new capsule drop' })
  async create(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: CreateDropDto) {
    return { message: 'Drop created and waitlist activated', data: await this.dropsService.create(brand.brandId, dto) };
  }

  @Get(':id/report')
  @ApiOperation({ summary: 'How a launch did: first 24 hours and 7 days, and how much of the waitlist tried it on' })
  async report(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Launch report fetched', data: await this.launches.report(brand.brandId, id) };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a drop' })
  async update(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string, @Body() dto: UpdateDropDto) {
    return { message: 'Drop updated', data: await this.dropsService.update(brand.brandId, id, dto) };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a drop' })
  async remove(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Drop deleted', data: await this.dropsService.remove(brand.brandId, id) };
  }
}
