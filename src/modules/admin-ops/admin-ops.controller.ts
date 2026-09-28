import { Controller, Delete, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';
import { AdminService } from '../admin/admin.service';
import { ReportsService } from '../admin/reports/reports.service';
import { AdminTrafficFilterDto } from '../admin/dto/admin.dto';
import { AdminOpsService } from './admin-ops.service';

@ApiTags('Admin Panel — Operations')
@ApiBearerAuth()
@Controller('admin-panel')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class AdminOpsController {
  constructor(
    private readonly ops: AdminOpsService,
    private readonly reports: ReportsService,
    private readonly legacyAdmin: AdminService,
  ) {}

  // ─── Audit log ─────────────────────────────────────────────────────────────

  @Get('audit-logs')
  async auditLogs(@Query() query: { page?: string; limit?: string; action?: string; entityType?: string; adminUserId?: string; from?: string; to?: string }) {
    const res = await this.ops.auditLogs(query);
    return { message: 'Audit log fetched', data: res.data, meta: res.meta };
  }

  @Get('audit-logs/facets')
  async auditFacets() {
    return { data: await this.ops.auditFacets() };
  }

  // ─── Reports (previously only on the legacy /admin routes) ─────────────────

  @Get('reports/users')
  async userReport() {
    return { message: 'User activity report', data: await this.reports.getUserActivityReport() };
  }

  @Get('reports/chats')
  async chatReport() {
    return { message: 'Chat activity report', data: await this.reports.getChatActivityReport() };
  }

  @Get('reports/traffic')
  async trafficReport() {
    return { message: 'System traffic report', data: await this.reports.getSystemTrafficReport() };
  }

  @Get('traffic')
  async traffic(@Query() filter: AdminTrafficFilterDto) {
    const res = await this.legacyAdmin.getTrafficLogs(filter);
    return { message: 'Traffic logs fetched', data: res.logs, meta: res.meta };
  }

  @Get('traffic/suspicious')
  async suspicious(@Query() filter: AdminTrafficFilterDto) {
    const res = await this.legacyAdmin.getSuspiciousTraffic(filter);
    return { message: 'Suspicious traffic fetched', data: res.logs, meta: res.meta };
  }

  // ─── Community moderation ──────────────────────────────────────────────────

  @Get('community/overview')
  async overview() {
    return { data: await this.ops.overview() };
  }

  @Get('community/circles')
  async circles(@Query() query: { page?: string; limit?: string }) {
    const res = await this.ops.circles(query);
    return { data: res.data, meta: res.meta };
  }

  @Get('community/events')
  async events(@Query() query: { page?: string; limit?: string; search?: string }) {
    const res = await this.ops.events(query);
    return { data: res.data, meta: res.meta };
  }

  @Delete('community/events/:id')
  async deleteEvent(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return { message: 'Event deleted', data: await this.ops.deleteEvent(id, admin) };
  }

  @Get('community/borrows')
  async borrows(@Query() query: { page?: string; limit?: string; status?: string }) {
    const res = await this.ops.borrows(query);
    return { data: res.data, meta: res.meta };
  }
}
