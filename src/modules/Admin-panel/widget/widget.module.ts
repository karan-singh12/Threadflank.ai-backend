import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuditLogModule } from '../../../shared/audit/audit-log.module';
import { BrandsModule } from '../brands/brands.module';
import { SdkModule } from '../../../sdk';
import { WidgetAdminController } from './widget.controller';
import { WidgetPublicController } from '../../User-panel/widget/widget-public.controller';
import { WidgetService } from './widget.service';
import { WidgetTryOnService } from '../../User-panel/widget/widget-tryon.service';
import { ImageProviderModule } from '../../../shared/image-provider/image-provider.module';
import { StorageModule } from '../../../shared/storage/storage.module';

@Module({
  imports: [PrismaModule, AdminAuthModule, AuditLogModule, BrandsModule, SdkModule, ImageProviderModule, StorageModule.register()],
  controllers: [WidgetPublicController, WidgetAdminController],
  providers: [WidgetService, WidgetTryOnService],
})
export class WidgetModule {}
