import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../../shared/storage/storage.module';
import { UploadsModule } from '../uploads/uploads.module';

// Controllers
import { BrandAuthController } from './auth/brand-auth.controller';
import { BrandProfileController } from './profile/brand-profile.controller';
import { BrandCatalogController } from './catalog/brand-catalog.controller';
import { BrandAnalyticsController } from './analytics/brand-analytics.controller';
import { BrandAiStudioController } from './ai-studio/brand-ai-studio.controller';
import { BrandBiddingController } from './bidding/brand-bidding.controller';
import { BrandDropsController } from './drops/brand-drops.controller';
import { BrandUploadController } from './upload/brand-upload.controller';

// Services
import { BrandAuthService } from './auth/brand-auth.service';
import { BrandJwtStrategy } from './auth/brand-jwt.strategy';
import { BrandAuthGuard } from './auth/brand-auth.guard';
import { BrandProfileService } from './profile/brand-profile.service';
import { BrandCatalogService } from './catalog/brand-catalog.service';
import { BrandAnalyticsService } from './analytics/brand-analytics.service';
import { BrandAiStudioService } from './ai-studio/brand-ai-studio.service';
import { BrandBiddingService } from './bidding/brand-bidding.service';
import { BrandDropsService } from './drops/brand-drops.service';
import { BrandUploadService } from './upload/brand-upload.service';

@Module({
  imports: [
    PrismaModule,
    StorageModule.register(),
    UploadsModule,
    // No default secret: BrandJwtStrategy always passes its own, so brand tokens never share the user secret.
    JwtModule.register({}),
  ],
  controllers: [
    BrandAuthController,
    BrandProfileController,
    BrandCatalogController,
    BrandAnalyticsController,
    BrandAiStudioController,
    BrandBiddingController,
    BrandDropsController,
    BrandUploadController,
  ],
  providers: [
    BrandAuthService,
    BrandJwtStrategy,
    BrandAuthGuard,
    BrandProfileService,
    BrandCatalogService,
    BrandAnalyticsService,
    BrandAiStudioService,
    BrandBiddingService,
    BrandDropsService,
    BrandUploadService,
  ],
  exports: [
    BrandAuthService,
    BrandJwtStrategy,
    BrandAuthGuard,
    BrandProfileService,
    BrandCatalogService,
    BrandAnalyticsService,
    BrandAiStudioService,
    BrandBiddingService,
    BrandDropsService,
    BrandUploadService,
  ],
})
export class BrandPanelModule {}

