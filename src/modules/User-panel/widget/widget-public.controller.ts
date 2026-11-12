import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuthGuard } from '../../Admin-panel/admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../../Admin-panel/admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../../../common/interfaces/admin-jwt-payload.interface';
import { WidgetService, type WidgetSessionInput } from '../../Admin-panel/widget/widget.service';

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
