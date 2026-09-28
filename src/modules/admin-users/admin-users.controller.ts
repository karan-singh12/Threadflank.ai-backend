import { Controller, Get, Post, Param, Query, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminUsersService } from './admin-users.service';
import { AdminPanelUserFilterDto } from './dto/user-filter.dto';
import { SuspendUserDto } from './dto/suspend-user.dto';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminRolesGuard } from '../admin-auth/guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { MESSAGES } from '../../common/constants/messages.constant';
import { AdminRole } from '@prisma/client';
import { AuthenticatedAdmin } from '../../common/interfaces/admin-jwt-payload.interface';

/**
 * Admin-panel read/suspend view of end-user accounts. Deliberately separate
 * from the existing `/admin/users` (role-toggle) surface — see
 * admin-users.service.ts for why suspend() does not (yet) block login.
 */
@ApiTags('Admin Panel — Users')
@ApiBearerAuth()
@Controller('admin-panel/users')
@UseGuards(AdminAuthGuard, AdminRolesGuard)
@AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'List end-user accounts' })
  async findAll(@Query() filter: AdminPanelUserFilterDto) {
    const result = await this.adminUsersService.findAll(filter);
    return { message: MESSAGES.adminUsers.listFetched, data: result.users, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single end-user account' })
  async findOne(@Param('id') id: string) {
    const user = await this.adminUsersService.findOne(id);
    return { message: MESSAGES.adminUsers.fetched, data: user };
  }

  @Post(':id/suspend')
  @ApiOperation({ summary: 'Suspend a user (audit record only — does not block login, see service docstring)' })
  async suspend(@Param('id') id: string, @Body() dto: SuspendUserDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const suspension = await this.adminUsersService.suspend(id, dto.reason, admin);
    return { message: MESSAGES.adminUsers.suspended, data: suspension };
  }

  @Post(':id/unsuspend')
  @ApiOperation({ summary: 'Lift a user suspension' })
  async unsuspend(@Param('id') id: string, @CurrentAdmin() admin: AuthenticatedAdmin) {
    const suspension = await this.adminUsersService.unsuspend(id, admin);
    return { message: MESSAGES.adminUsers.unsuspended, data: suspension };
  }
}
