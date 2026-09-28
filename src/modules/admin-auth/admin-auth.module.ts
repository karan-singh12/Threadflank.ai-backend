import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { AdminRolesGuard } from './guards/admin-roles.guard';
import { PrismaModule } from '../../prisma/prisma.module';
import { MailerModule } from '../../shared/mailer/mailer.module';
import { AuditLogModule } from '../../shared/audit/audit-log.module';
import { AppLogger } from '../../shared/logger/logger.service';

/**
 * Separate admin/staff auth domain. Registers JwtModule with no default
 * secret — AdminJwtStrategy always passes an explicit secret per call, so
 * this module can never accidentally fall back to the end-user JWT_SECRET.
 */
@Module({
  imports: [PrismaModule, MailerModule, AuditLogModule, JwtModule.register({})],
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminJwtStrategy, AdminAuthGuard, AdminRolesGuard, AppLogger],
  exports: [AdminJwtStrategy, AdminAuthGuard, AdminRolesGuard],
})
export class AdminAuthModule {}
