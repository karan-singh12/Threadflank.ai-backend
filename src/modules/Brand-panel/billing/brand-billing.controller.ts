import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminRole } from '@prisma/client';
import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';
import { AdminAuthGuard } from '../../Admin-panel/admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../../Admin-panel/admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../../common/decorators/admin-roles.decorator';
import { assertOwner, BrandBillingService } from './brand-billing.service';

class QuoteDto {
  @ApiProperty({ example: 'growth' })
  @IsString()
  @MaxLength(40)
  packId!: string;

  @ApiPropertyOptional({ example: 'LAUNCH20' })
  @IsString()
  @IsOptional()
  @MaxLength(40)
  code?: string;
}

class VerifyDto {
  @IsString() @MaxLength(80) orderId!: string;
  @IsString() @MaxLength(80) paymentId!: string;
  @IsString() @MaxLength(200) signature!: string;
}

class CouponDto {
  @ApiProperty({ example: 'LAUNCH20' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{3,32}$/, { message: 'Use 3-32 letters, numbers, dashes or underscores.' })
  code!: string;

  @ApiPropertyOptional({ description: 'Percent off the pack price (1-90)' })
  @IsInt() @Min(1) @Max(90) @IsOptional()
  percentOff?: number;

  @ApiPropertyOptional({ description: 'Extra credits on top of the pack' })
  @IsInt() @Min(1) @Max(5000) @IsOptional()
  bonusCredits?: number;

  @ApiPropertyOptional({ description: 'How many purchases can use it' })
  @IsInt() @Min(1) @IsOptional()
  maxUses?: number;

  @ApiPropertyOptional()
  @IsISO8601() @IsOptional()
  expiresAt?: string;
}

class CouponActiveDto {
  @IsBoolean() isActive!: boolean;
}

@ApiTags('Brand Panel — Billing')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/billing')
export class BrandBillingController {
  constructor(private readonly billing: BrandBillingService) {}

  @Get()
  @ApiOperation({ summary: 'AI credit packs, the balance and whether payments are switched on' })
  async overview(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Billing fetched', data: await this.billing.overview(brand.brandId) };
  }

  @Post('quote')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Price of a pack with an optional promo code' })
  async quote(@Body() dto: QuoteDto) {
    return { message: 'Quote ready', data: await this.billing.quote(dto.packId, dto.code) };
  }

  @Post('order')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a Razorpay payment for a pack (owner only)' })
  async order(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: QuoteDto) {
    assertOwner(brand.role);
    return { message: 'Order created', data: await this.billing.createOrder(brand.brandId, dto.packId, dto.code) };
  }

  @Post('verify')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm a Checkout payment and add the credits (owner only)' })
  async verify(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: VerifyDto) {
    assertOwner(brand.role);
    return { message: 'Payment confirmed', data: await this.billing.verify(brand.brandId, dto) };
  }

  @Get('payments')
  @ApiOperation({ summary: 'Past credit purchases' })
  async payments(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Payments fetched', data: await this.billing.history(brand.brandId) };
  }
}

@ApiTags('Admin Panel — Brand promo codes')
@ApiBearerAuth()
@Controller('admin-panel/brand-coupons')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class BrandCouponsAdminController {
  constructor(private readonly billing: BrandBillingService) {}

  @Get()
  async list() {
    return { message: 'Codes fetched', data: await this.billing.listCoupons() };
  }

  @Post()
  async create(@Body() dto: CouponDto) {
    return { message: 'Code created', data: await this.billing.createCoupon(dto) };
  }

  @Patch(':id')
  async setActive(@Param('id') id: string, @Body() dto: CouponActiveDto) {
    return { message: 'Code updated', data: await this.billing.setCouponActive(id, dto.isActive) };
  }
}
