import { Controller, Get, Patch, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { BrandProfileService } from './brand-profile.service';
import { UpdateBrandProfileDto } from '../dto/brand-common.dto';

@ApiTags('Brand Panel — Profile & Storefront')
@Controller('brand/profile')
export class BrandProfileController {
  constructor(private readonly profileService: BrandProfileService) {}

  @Get()
  @ApiOperation({ summary: 'Get Brand Profile & Atelier Settings' })
  async getProfile() {
    const data = await this.profileService.getProfile();
    return {
      message: 'Brand profile fetched successfully',
      data,
    };
  }

  @Patch()
  @ApiOperation({ summary: 'Update Brand Profile, Bio & Storefront Settings' })
  async updateProfile(@Body() dto: UpdateBrandProfileDto) {
    const data = await this.profileService.updateProfile(dto);
    return {
      message: 'Brand profile updated successfully',
      data,
    };
  }
}

