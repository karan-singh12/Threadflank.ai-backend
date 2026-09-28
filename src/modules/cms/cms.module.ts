import { Module } from '@nestjs/common';
import { CmsController } from './cms.controller';
import { CmsPublicController } from './cms-public.controller';
import { CmsService } from './cms.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditLogModule } from '../../shared/audit/audit-log.module';
import { SdkModule } from '../../sdk';
import { AppLogger } from '../../shared/logger/logger.service';

@Module({
  imports: [PrismaModule, AdminAuthModule, AuditLogModule, SdkModule],
  controllers: [CmsController, CmsPublicController],
  providers: [CmsService, AppLogger],
  exports: [CmsService],
})
export class CmsModule {}
