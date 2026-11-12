import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../../../common/interfaces/admin-jwt-payload.interface';
import { BrandPortalService } from './brand-portal.service';
import { BrandPortalFilterDto, SetAccountActiveDto, VerificationDecisionDto } from './brand-portal.dto';

@ApiTags('Admin Panel — Brand portal')
@ApiBearerAuth()
@Controller('admin-panel/brand-portal')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.BRAND_MANAGER)
export class BrandPortalController {
  constructor(private readonly service: BrandPortalService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Counts of brand-panel brands by verification status' })
  async overview(@CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Overview fetched', data: await this.service.overview(admin) };
  }

  @Get('brands')
  @ApiOperation({ summary: 'Brands registered through the brand panel' })
  async list(@Query() filter: BrandPortalFilterDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const r = await this.service.list(filter, admin);
    return { message: 'Brands fetched', data: r.brands, meta: r.meta };
  }

  @Get('brands/:id')
  @ApiOperation({ summary: 'Brand detail with accounts, metrics and content counts' })
  async detail(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Brand fetched', data: await this.service.detail(id, admin) };
  }

  @Get('brands/:id/catalog')
  @ApiOperation({ summary: "A brand's garment catalog" })
  async catalog(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Catalog fetched', data: await this.service.catalogOf(id, admin) };
  }

  @Delete('brands/:id/catalog/:itemId')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Remove a garment from a brand catalog (moderation)' })
  async removeGarment(@Param('id') id: string, @Param('itemId') itemId: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Garment removed', data: await this.service.removeGarment(id, itemId, admin) };
  }

  @Get('brands/:id/drops')
  @ApiOperation({ summary: "A brand's launch drops" })
  async drops(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Drops fetched', data: await this.service.dropsOf(id, admin) };
  }

  @Get('brands/:id/bids')
  @ApiOperation({ summary: "A brand's standing on the runway bidding board" })
  async bids(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Bids fetched', data: await this.service.bidsOf(id, admin) };
  }

  @Post('brands/:id/verification')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Approve, reject or suspend a brand' })
  async decide(@Param('id') id: string, @Body() dto: VerificationDecisionDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Decision recorded', data: await this.service.decide(id, dto, admin) };
  }

  @Patch('brands/:id/accounts/:accountId')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Enable or disable a brand login' })
  async setActive(@Param('id') id: string, @Param('accountId') accountId: string, @Body() dto: SetAccountActiveDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Account updated', data: await this.service.setAccountActive(id, accountId, dto.isActive, admin) };
  }

  @Post('brands/:id/accounts/:accountId/verify-email')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: "Mark a brand login's email as verified" })
  async verifyEmail(@Param('id') id: string, @Param('accountId') accountId: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Email verified', data: await this.service.verifyAccountEmail(id, accountId, admin) };
  }
}
