import { Module } from '@nestjs/common';
import { AuditLogModule } from '../../../shared/audit/audit-log.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { BrandPanelModule } from '../../Brand-panel/brand-panel.module';
import { DiscoverCategoriesController } from './discover-categories.controller';

@Module({
  imports: [AdminAuthModule, AuditLogModule, BrandPanelModule],
  controllers: [DiscoverCategoriesController],
})
export class DiscoverCategoriesModule {}
