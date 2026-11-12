import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuditLogModule } from '../../../shared/audit/audit-log.module';
import { MailerModule } from '../../../shared/mailer/mailer.module';
import { AppLogger } from '../../../shared/logger/logger.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { BrandsModule } from '../brands/brands.module';
import { BrandPanelModule } from '../../Brand-panel/brand-panel.module';
import { BrandPortalController } from './brand-portal.controller';
import { BrandPortalService } from './brand-portal.service';

@Module({
  imports: [PrismaModule, AdminAuthModule, AuditLogModule, MailerModule, BrandsModule, BrandPanelModule],
  controllers: [BrandPortalController],
  providers: [AppLogger, BrandPortalService],
})
export class BrandPortalModule {}
