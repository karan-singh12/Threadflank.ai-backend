import { Module } from '@nestjs/common';
import { StudioBackgroundsService } from './studio-backgrounds.service';
import { StudioBackgroundsPublicController } from './studio-backgrounds-public.controller';
import { StudioBackgroundsController } from './studio-backgrounds.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditLogModule } from '../../shared/audit/audit-log.module';

@Module({
  imports: [PrismaModule, AdminAuthModule, AuditLogModule],
  controllers: [StudioBackgroundsPublicController, StudioBackgroundsController],
  providers: [StudioBackgroundsService],
  exports: [StudioBackgroundsService],
})
export class StudioBackgroundsModule {}
