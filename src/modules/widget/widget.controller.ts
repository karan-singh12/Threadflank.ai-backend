import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';
import { WidgetService, type WidgetSessionInput } from './widget.service';

@ApiTags('D2C try-on widget')
@Controller('widget')
export class WidgetPublicController {
  constructor(private readonly widget: WidgetService) {}

  @Get('config')
  async config(@Query('key') key: string, @Query('origin') origin?: string) {
    return { data: await this.widget.config(key, origin) };
  }

  @Post('session')
  async session(@Body() body: WidgetSessionInput) {
    return { data: await this.widget.recordSession(body) };
  }
}

@ApiTags('Admin Panel — Try-on widget')
@ApiBearerAuth()
@Controller('admin-panel/brands/:brandId/widget')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN, AdminRole.BRAND_MANAGER)
export class WidgetAdminController {
  constructor(private readonly widget: WidgetService) {}

  @Get()
  async get(@Param('brandId') brandId: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { data: await this.widget.adminGet(brandId, admin) };
  }

  @Put()
  async update(@Param('brandId') brandId: string, @Body() body: { enabled?: boolean; domains?: string[] }, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Widget settings saved', data: await this.widget.update(brandId, body ?? {}, admin) };
  }

  @Post('key')
  async rotate(@Param('brandId') brandId: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'New widget key issued', data: await this.widget.rotateKey(brandId, admin) };
  }
}
