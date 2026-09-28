import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';
import { BrandProductVariantsService, VariantInput } from './brand-product-variants.service';

@ApiTags('Admin Panel — Product Variants')
@ApiBearerAuth()
@Controller('admin-panel')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.BRAND_MANAGER)
export class BrandProductVariantsController {
  constructor(private readonly variants: BrandProductVariantsService) {}

  @Get('brand-posts/:postId/variants')
  @ApiOperation({ summary: 'List size/colour/stock variants for a brand post' })
  async list(@Param('postId') postId: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Variants fetched', data: await this.variants.list(postId, admin) };
  }

  @Post('brand-posts/:postId/variants')
  async create(@Param('postId') postId: string, @Body() body: VariantInput, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Variant created', data: await this.variants.create(postId, body ?? {}, admin) };
  }

  @Put('variants/:id')
  async update(@Param('id') id: string, @Body() body: VariantInput, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Variant updated', data: await this.variants.update(id, body ?? {}, admin) };
  }

  @Delete('variants/:id')
  async remove(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Variant deleted', data: await this.variants.remove(id, admin) };
  }
}
