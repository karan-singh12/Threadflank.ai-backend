import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min, ValidateIf } from 'class-validator';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';
import { PromotionsService } from './promotions.service';

export class OfferDto {
  @IsOptional() @IsIn(['COUPON', 'FLASH_SALE']) kind?: 'COUPON' | 'FLASH_SALE';
  @IsOptional() @IsString() @MaxLength(80) title?: string;
  @IsOptional() @IsString() @MaxLength(20) code?: string;
  @IsOptional() @ValidateIf((o) => o.percentOff !== null) @IsInt() @Min(1) percentOff?: number | null;
  @IsOptional() @ValidateIf((o) => o.amountOff !== null) @IsInt() @Min(1) amountOff?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) productIds?: string[];
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@ApiTags('Brand Panel — Promotions')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/promotions')
export class BrandPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get('offers')
  async list(@CurrentBrand() b: AuthenticatedBrand) {
    return { message: 'Offers fetched', data: await this.promotions.list(b.brandId) };
  }

  @Post('offers')
  @ApiOperation({ summary: 'Create a discount code or flash sale shown on your store and pieces' })
  async create(@CurrentBrand() b: AuthenticatedBrand, @Body() dto: OfferDto) {
    return { message: 'Offer created', data: await this.promotions.create(b.brandId, dto) };
  }

  @Patch('offers/:id')
  async update(@CurrentBrand() b: AuthenticatedBrand, @Param('id') id: string, @Body() dto: OfferDto) {
    return { message: 'Offer updated', data: await this.promotions.update(b.brandId, id, dto) };
  }

  @Get('report')
  @ApiOperation({ summary: 'Sponsored slot spend against what it brought, and how each offer did' })
  async report(@CurrentBrand() b: AuthenticatedBrand) {
    return { message: 'Promotion report fetched', data: await this.promotions.report(b.brandId) };
  }
}

@ApiTags('Brands (App) — offers')
@Controller('brands')
export class OffersPublicController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get(':slug/offers')
  async live(@Param('slug') slug: string) {
    return { message: 'Offers fetched', data: await this.promotions.liveForSlug(slug) };
  }

  @Post('offers/:id/copied')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async copied(@Param('id') id: string) {
    return { message: 'Counted', data: await this.promotions.copied(id) };
  }
}
