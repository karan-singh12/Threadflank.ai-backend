import { Injectable, BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';
import { AdminLoginDto } from './dto/login.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AdminFilterDto } from './dto/admin-filter.dto';
import { MESSAGES } from '../../common/constants/messages.constant';
import { APP_CONSTANTS } from '../../common/constants/app.constant';
import { buildPaginationMeta } from '../../common/dto/pagination-query.dto';
import { MailerService } from '../../shared/mailer/mailer.service';
import { AuditLogService } from '../../shared/audit/audit-log.service';
import { AppLogger } from '../../shared/logger/logger.service';

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminJwt: AdminJwtStrategy,
    private readonly mailer: MailerService,
    private readonly audit: AuditLogService,
    private readonly logger: AppLogger,
  ) {}

  private async issueTokenPair(admin: { id: string; email: string; role: any }, meta: RequestMeta) {
    const payload = { adminUserId: admin.id, email: admin.email, role: admin.role };
    const [accessToken, refreshToken] = await Promise.all([
      this.adminJwt.signAccessToken(payload),
      this.adminJwt.signRefreshToken(payload),
    ]);

    await this.prisma.adminRefreshToken.create({
      data: {
        adminUserId: admin.id,
        tokenHash: hashToken(refreshToken),
        userAgent: meta.userAgent ?? null,
        ip: meta.ip ?? null,
        expiresAt: new Date(Date.now() + APP_CONSTANTS.adminAuth.refreshTokenExpiryMs),
      },
    });

    return { accessToken, refreshToken };
  }

  async login(dto: AdminLoginDto, meta: RequestMeta) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!admin) {
      throw new UnauthorizedException(MESSAGES.adminAuth.invalidCredentials);
    }
    if (!admin.isActive) {
      throw new ForbiddenException(MESSAGES.adminAuth.accountInactive);
    }

    const passwordValid = await bcrypt.compare(dto.password, admin.password);
    if (!passwordValid) {
      throw new UnauthorizedException(MESSAGES.adminAuth.invalidCredentials);
    }

    const tokens = await this.issueTokenPair(admin, meta);
    await this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    await this.audit.log({
      adminUserId: admin.id,
      action: 'ADMIN_LOGIN',
      entityType: 'AdminUser',
      entityId: admin.id,
      ip: meta.ip,
    });

    return {
      ...tokens,
      admin: { id: admin.id, email: admin.email, name: admin.name, role: admin.role },
    };
  }

  async refresh(refreshToken: string, meta: RequestMeta) {
    const payload = await this.adminJwt.verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const stored = await this.prisma.adminRefreshToken.findFirst({
      where: { adminUserId: payload.adminUserId, tokenHash, revokedAt: null },
    });
    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException(MESSAGES.adminAuth.refreshInvalid);
    }

    const admin = await this.prisma.adminUser.findUnique({ where: { id: payload.adminUserId } });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException(MESSAGES.adminAuth.refreshInvalid);
    }

    // Rotate: revoke the used refresh token, issue a fresh pair.
    await this.prisma.adminRefreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokenPair(admin, meta);
  }

  async logout(refreshToken: string) {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.adminRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: dto.email.toLowerCase() } });

    // Always resolve the same way regardless of whether the admin exists,
    // so this endpoint can't be used to enumerate admin emails.
    if (!admin || !admin.isActive) {
      return;
    }

    const rawToken = randomBytes(32).toString('hex');
    await this.prisma.adminPasswordReset.create({
      data: {
        adminUserId: admin.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + APP_CONSTANTS.adminAuth.passwordResetExpiryMin * 60 * 1000),
      },
    });

    const resetUrl = `${process.env.ADMIN_PASSWORD_RESET_URL || 'http://localhost:3001/reset-password/'}${rawToken}`;

    try {
      await this.mailer.send({
        to: admin.email,
        subject: 'Reset your Threadflank admin password',
        html: `<p>Hi ${admin.name},</p><p>Click the link below to reset your admin password. This link expires in ${APP_CONSTANTS.adminAuth.passwordResetExpiryMin} minutes.</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
      });
    } catch (error) {
      // Mail delivery failure shouldn't leak whether the account exists, but
      // is logged — including the URL, so local/dev testing works without a
      // configured mail provider.
      this.logger.warn('AdminAuthService', `Password reset email not sent (mailer not configured?) — dev link: ${resetUrl}`);
      this.logger.error('AdminAuthService', 'Failed to send password reset email', error);
    }

    await this.audit.log({
      adminUserId: admin.id,
      action: 'ADMIN_PASSWORD_RESET_REQUESTED',
      entityType: 'AdminUser',
      entityId: admin.id,
    });
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = hashToken(dto.token);
    const reset = await this.prisma.adminPasswordReset.findFirst({
      where: { tokenHash, usedAt: null },
    });

    if (!reset || reset.expiresAt < new Date()) {
      throw new BadRequestException(MESSAGES.adminAuth.resetInvalid);
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);

    await this.prisma.$transaction([
      this.prisma.adminUser.update({ where: { id: reset.adminUserId }, data: { password: hashedPassword } }),
      this.prisma.adminPasswordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
      // Revoke every existing session on password reset.
      this.prisma.adminRefreshToken.updateMany({
        where: { adminUserId: reset.adminUserId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.log({
      adminUserId: reset.adminUserId,
      action: 'ADMIN_PASSWORD_RESET',
      entityType: 'AdminUser',
      entityId: reset.adminUserId,
    });
  }

  async createAdmin(dto: CreateAdminDto, createdBy: { adminUserId: string }) {
    const existing = await this.prisma.adminUser.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) {
      throw new BadRequestException(MESSAGES.adminAuth.emailExists);
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const admin = await this.prisma.adminUser.create({
      data: {
        email: dto.email.toLowerCase(),
        password: hashedPassword,
        name: dto.name,
        role: dto.role,
      },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    });

    await this.audit.log({
      adminUserId: createdBy.adminUserId,
      action: 'ADMIN_CREATED',
      entityType: 'AdminUser',
      entityId: admin.id,
      metadata: { role: admin.role },
    });

    return admin;
  }

  async getCurrentAdmin(adminUserId: string) {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: adminUserId },
      select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
    });
    if (!admin) throw new UnauthorizedException(MESSAGES.adminAuth.tokenInvalid);
    return admin;
  }

  async listAdmins(filter: AdminFilterDto) {
    const page = filter.page ?? 1;
    const limit = Math.min(filter.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filter.role) where.role = filter.role;
    if (filter.search) {
      where.OR = [
        { email: { contains: filter.search, mode: 'insensitive' } },
        { name: { contains: filter.search, mode: 'insensitive' } },
      ];
    }

    const [admins, total] = await Promise.all([
      this.prisma.adminUser.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, name: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
      }),
      this.prisma.adminUser.count({ where }),
    ]);

    return { admins, meta: buildPaginationMeta(total, page, limit) };
  }
}
