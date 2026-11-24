import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { BrandProfileService } from './brand-profile.service';
import { UpdateBrandProfileDto } from '../dto/brand-common.dto';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { IsBoolean, IsOptional } from 'class-validator';
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

  @Get('notifications')
  @ApiOperation({ summary: 'Which emails the brand team gets' })
  async notifications(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Notification settings fetched', data: await this.profileService.notifications(brand.brandId) };
  }

  @Patch('notifications')
  @ApiOperation({ summary: 'Switch brand emails on or off (owner and managers)' })
  async setNotifications(@CurrentBrand() brand: AuthenticatedBrand, @Body() dto: NotifyPrefsDto) {
    return { message: 'Notification settings saved', data: await this.profileService.setNotifications(brand.brandId, { ...dto }) };
  }
}

/** One switch per kind in NOTIFY_KINDS; any left out keep their current value. */
class NotifyPrefsDto {
  @IsOptional() @IsBoolean() inbox?: boolean;
  @IsOptional() @IsBoolean() reviews?: boolean;
  @IsOptional() @IsBoolean() looks?: boolean;
  @IsOptional() @IsBoolean() collabs?: boolean;
  @IsOptional() @IsBoolean() ranking?: boolean;
}
