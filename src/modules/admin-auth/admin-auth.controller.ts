import { Controller, Post, Get, Body, Query, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { AdminFilterDto } from './dto/admin-filter.dto';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { AdminRolesGuard } from './guards/admin-roles.guard';
import { AdminRoles } from '../../common/decorators/admin-roles.decorator';
import { CurrentAdmin } from '../../common/decorators/current-admin.decorator';
import { MESSAGES } from '../../common/constants/messages.constant';
import { AdminRole } from '@prisma/client';

@ApiTags('Admin Panel Auth')
// Brute-force guard for login/signup/password reset.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('admin-panel/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Admin/staff login (separate from end-user auth)' })
  async login(@Body() dto: AdminLoginDto, @Req() req: any) {
    const result = await this.adminAuthService.login(dto, this.requestMeta(req));
    return { message: MESSAGES.adminAuth.loginSuccess, data: result };
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Rotate an admin refresh token for a new access/refresh pair' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: any) {
    const result = await this.adminAuthService.refresh(dto.refreshToken, this.requestMeta(req));
    return { message: MESSAGES.adminAuth.refreshed, data: result };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke an admin refresh token' })
  async logout(@Body() dto: RefreshTokenDto) {
    await this.adminAuthService.logout(dto.refreshToken);
    return { message: MESSAGES.adminAuth.logoutSuccess };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request an admin password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.adminAuthService.forgotPassword(dto);
    return { message: MESSAGES.adminAuth.resetRequested };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset an admin password using a valid reset token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.adminAuthService.resetPassword(dto);
    return { message: MESSAGES.adminAuth.resetSuccess };
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard)
  @ApiOperation({ summary: 'Get the currently authenticated admin (session restore on app load)' })
  async me(@CurrentAdmin() admin: any) {
    const current = await this.adminAuthService.getCurrentAdmin(admin.adminUserId);
    return { message: MESSAGES.adminAuth.currentFetched, data: current };
  }

  @Post('admins')
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard, AdminRolesGuard)
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'Create a new staff/admin account (SUPER_ADMIN or ADMIN only)' })
  async createAdmin(@Body() dto: CreateAdminDto, @CurrentAdmin() admin: any) {
    const created = await this.adminAuthService.createAdmin(dto, { adminUserId: admin.adminUserId });
    return { message: MESSAGES.adminAuth.adminCreated, data: created };
  }

  @Get('admins')
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard, AdminRolesGuard)
  @AdminRoles(AdminRole.SUPER_ADMIN, AdminRole.ADMIN)
  @ApiOperation({ summary: 'List staff/admin accounts (SUPER_ADMIN or ADMIN only)' })
  async listAdmins(@Query() filter: AdminFilterDto) {
    const result = await this.adminAuthService.listAdmins(filter);
    return { message: MESSAGES.adminAuth.listFetched, data: result.admins, meta: result.meta };
  }

  private requestMeta(req: any) {
    return {
      ip: req.ip || req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress,
      userAgent: req.headers?.['user-agent'],
    };
  }
}
