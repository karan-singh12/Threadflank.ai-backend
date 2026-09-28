import { Module } from '@nestjs/common';
import { BrandStoriesController } from './brand-stories.controller';
import { BrandStoriesPublicController } from './brand-stories-public.controller';
import { BrandStoriesService } from './brand-stories.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../../auth/auth.module';
import { AuditLogModule } from '../../shared/audit/audit-log.module';
import { BrandsModule } from '../brands/brands.module';

@Module({
  imports: [PrismaModule, AdminAuthModule, AuthModule, AuditLogModule, BrandsModule],
  controllers: [BrandStoriesController, BrandStoriesPublicController],
  providers: [BrandStoriesService],
  exports: [BrandStoriesService],
})
export class BrandStoriesModule {}
