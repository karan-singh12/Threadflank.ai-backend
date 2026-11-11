import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandProfileService } from './brand-profile.service';
import { UpdateBrandProfileDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';

@ApiTags('Brand Panel — Profile & Storefront')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/profile')
export class BrandProfileController {
  constructor(private readonly profileService: BrandProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get Brand Profile & Atelier Settings' })
  async getProfile(@CurrentBrand() brand: AuthenticatedBrand) {
    const data = await this.profileService.getProfile(brand.brandId);
    return { message: 'Brand profile fetched successfully', data };
  }

  @Patch()
  @ApiOperation({ summary: 'Update Brand Profile, Bio & Storefront Settings' })
  async updateProfile(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: UpdateBrandProfileDto) {
    const data = await this.profileService.updateProfile(brand.brandId, dto);
    return { message: 'Brand profile updated successfully', data };
  }
}
