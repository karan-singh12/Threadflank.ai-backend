import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditLogModule } from '../../shared/audit/audit-log.module';
import { BrandsModule } from '../brands/brands.module';
import { SdkModule } from '../../sdk';
import { WidgetAdminController, WidgetPublicController } from './widget.controller';
import { WidgetService } from './widget.service';

@Module({
  imports: [PrismaModule, AdminAuthModule, AuditLogModule, BrandsModule, SdkModule],
  controllers: [WidgetPublicController, WidgetAdminController],
  providers: [WidgetService],
})
export class WidgetModule {}
