import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../../../common/interfaces/admin-jwt-payload.interface';
import { BrandManagementService } from './brand-management.service';
import { AdminCatalogQueryDto, AdminCatalogStatusDto, GstDecisionDto, InviteOwnerDto, LookDecisionDto, ModerationReasonDto, RankingsQueryDto, SetPlanDto } from './brand-management.dto';

/** Plan, GST, purchases, community moderation and rankings for one brand, or across brands. */
@ApiTags('Admin Panel — Brand portal')
@ApiBearerAuth()
@Controller('admin-panel/brand-portal')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.BRAND_MANAGER)
export class BrandManagementController {
  constructor(private readonly service: BrandManagementService) {}

  @Get('rankings')
  @ApiOperation({ summary: 'Brand leaderboard for a month (live for the current month)' })
  async rankings(@Query() q: RankingsQueryDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Rankings fetched', data: await this.service.rankings(q.month, admin) };
  }

  @Get('brands/:id/account')
  @ApiOperation({ summary: 'Plan, GST, store, campaigns and community counts for a brand' })
  async account(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Brand account fetched', data: await this.service.account(id, admin) };
  }

  @Patch('brands/:id/plan')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Give or end a plan without a payment (reason required, audit-logged)' })
  async setPlan(@Param('id') id: string, @Body() dto: SetPlanDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Plan updated', data: await this.service.setPlan(id, dto, admin) };
  }

  @Post('brands/:id/gst')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Mark the GSTIN verified (shows the badge) or take the badge away' })
  async gst(@Param('id') id: string, @Body() dto: GstDecisionDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'GST status saved', data: await this.service.decideGst(id, dto, admin) };
  }

  @Post('brands/:id/invite-owner')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Create the owner login for a brand that has none and email a set-password link' })
  async inviteOwner(@Param('id') id: string, @Body() dto: InviteOwnerDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Owner invited', data: await this.service.inviteOwner(id, dto, admin) };
  }

  @Get('brands/:id/payments')
  @ApiOperation({ summary: "A brand's plan and credit purchases" })
  async payments(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Payments fetched', data: await this.service.payments(id, admin) };
  }

  @Get('brands/:id/payments/:paymentId/invoice')
  @ApiOperation({ summary: 'The GST invoice for one of the brand’s purchases' })
  async invoice(@Param('id') id: string, @Param('paymentId') paymentId: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Invoice fetched', data: await this.service.invoice(id, paymentId, admin) };
  }

  @Get('brands/:id/community')
  @ApiOperation({ summary: "Recent reviews, shoppers' looks and updates, for moderation" })
  async community(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Community fetched', data: await this.service.community(id, admin) };
  }

  @Delete('brands/:id/reviews/:reviewId')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  async removeReview(@Param('id') id: string, @Param('reviewId') reviewId: string, @Query() q: ModerationReasonDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Review removed', data: await this.service.removeReview(id, reviewId, q.reason, admin) };
  }

  @Patch('brands/:id/looks/:lookId')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  async decideLook(@Param('id') id: string, @Param('lookId') lookId: string, @Body() dto: LookDecisionDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Look updated', data: await this.service.decideLook(id, lookId, dto, admin) };
  }

  @Delete('brands/:id/updates/:updateId')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  async removeUpdate(@Param('id') id: string, @Param('updateId') updateId: string, @Query() q: ModerationReasonDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Update removed', data: await this.service.removeUpdate(id, updateId, q.reason, admin) };
  }
}

/** Every brand's pieces in one list, for browsing and moderation. */
@ApiTags('Admin Panel — Brand catalog')
@ApiBearerAuth()
@Controller('admin-panel/brand-catalog')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.BRAND_MANAGER)
export class BrandCatalogAdminController {
  constructor(private readonly service: BrandManagementService) {}

  @Get()
  @ApiOperation({ summary: 'Pieces from every brand, filtered and paged' })
  async list(@Query() q: AdminCatalogQueryDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const r = await this.service.catalog(q, admin);
    return { message: 'Catalog fetched', data: r.items, meta: { ...r.meta, facets: r.facets } };
  }

  @Patch(':itemId/status')
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Hide a piece from shoppers, or put it back' })
  async setStatus(@Param('itemId') itemId: string, @Body() dto: AdminCatalogStatusDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Piece updated', data: await this.service.setCatalogStatus(itemId, dto, admin) };
  }
}
