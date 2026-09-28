import { Module } from '@nestjs/common';
import { BrandPostsController } from './brand-posts.controller';
import { BrandPostsPublicController } from './brand-posts-public.controller';
import { BrandPostsService } from './brand-posts.service';
import { BrandProductVariantsService } from './brand-product-variants.service';
import { BrandProductVariantsController } from './brand-product-variants.controller';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../../auth/auth.module';
import { AuditLogModule } from '../../shared/audit/audit-log.module';
import { BrandsModule } from '../brands/brands.module';
import { SdkModule } from '../../sdk';

@Module({
  imports: [PrismaModule, AdminAuthModule, AuthModule, AuditLogModule, BrandsModule, SdkModule],
  controllers: [BrandPostsController, BrandPostsPublicController, BrandProductVariantsController],
  providers: [BrandPostsService, BrandProductVariantsService],
  exports: [BrandPostsService],
})
export class BrandPostsModule {}
