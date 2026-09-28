import { Module } from '@nestjs/common';
import { BrandsController } from './brands.controller';
import { BrandsPublicController } from './brands-public.controller';
import { BrandsService } from './brands.service';
import { BrandAccessService } from './brand-access.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AuthModule } from '../../auth/auth.module';
import { AuditLogModule } from '../../shared/audit/audit-log.module';

@Module({
  imports: [PrismaModule, AdminAuthModule, AuthModule, AuditLogModule],
  controllers: [BrandsController, BrandsPublicController],
  providers: [BrandsService, BrandAccessService],
  exports: [BrandsService, BrandAccessService],
})
export class BrandsModule {}
