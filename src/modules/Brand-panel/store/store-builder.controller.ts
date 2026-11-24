import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';
import { StoreBuilderService } from './store-builder.service';

export class SaveStoreDraftDto {
  @ApiProperty({ description: '{ version: 1, sections: StoreSection[], pinned: string[], coverVideo?: string }' })
  @IsObject()
  layout!: Record<string, unknown>;
}

export class ChangeSlugDto {
  @ApiProperty({ example: 'raw-mango' })
  @IsString()
  @MaxLength(60)
  slug!: string;
}

export class StorePreviewQueryDto {
  @ApiPropertyOptional({ enum: ['draft', 'published'] })
  @IsOptional()
  @IsIn(['draft', 'published'])
  which?: 'draft' | 'published';
}

@ApiTags('Brand Panel — Store Builder')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/store')
export class StoreBuilderController {
  constructor(private readonly builder: StoreBuilderService) {}

  @Get()
  @ApiOperation({ summary: 'The draft and published store layouts, and the store URL' })
  async get(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Store fetched', data: await this.builder.get(brand.brandId) };
  }

  @Put('draft')
  @ApiOperation({ summary: 'Save the layout being edited (shoppers keep seeing the published one)' })
  async save(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: SaveStoreDraftDto) {
    return { message: 'Draft saved', data: await this.builder.saveDraft(brand.brandId, dto.layout) };
  }

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Make the draft live for shoppers' })
  async publish(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Store published', data: await this.builder.publish(brand.brandId) };
  }

  @Post('discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Throw away unpublished changes' })
  async discard(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Draft discarded', data: await this.builder.discard(brand.brandId) };
  }

  @Get('preview')
  @ApiOperation({ summary: 'The store sections with their real pieces, as shoppers would see them' })
  async preview(@CurrentBrand() brand: AuthenticatedBrand, @Query() q: StorePreviewQueryDto) {
    return { message: 'Preview fetched', data: await this.builder.preview(brand.brandId, q.which ?? 'draft') };
  }

  @Patch('slug')
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiOperation({ summary: 'Change the store URL; the old one keeps redirecting' })
  async slug(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: ChangeSlugDto) {
    return { message: 'Store URL updated', data: await this.builder.changeSlug(brand.brandId, dto.slug) };
  }
}
