import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsISO8601, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { BrandAuthGuard, CurrentBrand } from '../auth/brand-auth.guard';
import { AuthenticatedBrand } from '../auth/brand-jwt.strategy';
import { AdminAuthGuard } from '../../Admin-panel/admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../../Admin-panel/admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../../common/decorators/admin-roles.decorator';
import { CampaignsService, MAX_ENTRY_PIECES } from './campaigns.service';

export class CampaignDto {
  @ApiPropertyOptional({ example: 'Diwali Edit 2026' }) @IsOptional() @IsString() @MinLength(3) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(600) description?: string;
  @ApiPropertyOptional({ example: 'Diwali' }) @IsOptional() @IsString() @MaxLength(60) occasion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @ValidateIf((o) => !!o.bannerUrl) @Matches(/^https:\/\//i, { message: 'Banner links must start with https://' }) bannerUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() endsAt?: string;
  @ApiPropertyOptional({ description: 'Empty string lets brands join until the end' }) @IsOptional() @ValidateIf((o) => !!o.joinBy) @IsISO8601() joinBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CampaignEntryDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_ENTRY_PIECES) @IsString({ each: true }) productIds!: string[];
}

@ApiTags('Admin Panel — Campaigns')
@ApiBearerAuth()
@Controller('admin-panel/campaigns')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class CampaignsAdminController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  async list() {
    return { message: 'Campaigns fetched', data: await this.campaigns.adminList() };
  }

  @Post()
  async create(@Body() dto: CampaignDto, @Req() req: any) {
    return { message: 'Campaign created', data: await this.campaigns.create(dto, req.adminUser?.adminUserId) };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: CampaignDto) {
    return { message: 'Campaign updated', data: await this.campaigns.update(id, dto) };
  }
}

@ApiTags('Brand Panel — Campaigns')
@ApiBearerAuth()
@UseGuards(BrandAuthGuard)
@Controller('brand/campaigns')
export class BrandCampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  @Get()
  @ApiOperation({ summary: 'Running and upcoming platform campaigns, with what this brand entered' })
  async list(@CurrentBrand() brand: AuthenticatedBrand) {
    return { message: 'Campaigns fetched', data: await this.campaigns.forBrand(brand.brandId) };
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Festivals, wedding seasons and campaigns over the next year' })
  async calendar() {
    return { message: 'Calendar fetched', data: await this.campaigns.calendar() };
  }

  @Put(':id/entry')
  @ApiOperation({ summary: 'Join a campaign, or change the pieces entered' })
  async join(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string, @Body() dto: CampaignEntryDto) {
    return { message: 'Campaign entry saved', data: await this.campaigns.join(brand.brandId, id, dto.productIds) };
  }

  @Delete(':id/entry')
  async leave(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Left the campaign', data: await this.campaigns.leave(brand.brandId, id) };
  }

  @Get(':id/report')
  @ApiOperation({ summary: "How the brand's campaign pieces did while it ran" })
  async report(@CurrentBrand() brand: AuthenticatedBrand, @Param('id') id: string) {
    return { message: 'Campaign report fetched', data: await this.campaigns.report(brand.brandId, id) };
  }
}
