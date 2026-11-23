import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailerModule } from '../../shared/mailer/mailer.module';
import { AppLogger } from '../../shared/logger/logger.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../../shared/storage/storage.module';
import { UploadsModule } from '../User-panel/uploads/uploads.module';
import { SdkModule } from '../../sdk';
import { ImageProviderModule } from '../../shared/image-provider/image-provider.module';

// Controllers
import { BrandAuthController } from './auth/brand-auth.controller';
import { BrandProfileController } from './profile/brand-profile.controller';
import { BrandCatalogController } from './catalog/brand-catalog.controller';
import { BrandAnalyticsController } from './analytics/brand-analytics.controller';
import { BrandAiStudioController } from './ai-studio/brand-ai-studio.controller';
import { BrandModelController } from './ai-studio/model/brand-model.controller';
import { BrandBiddingController } from './bidding/brand-bidding.controller';
import { BrandDropsController } from './drops/brand-drops.controller';
import { BrandUploadController } from './upload/brand-upload.controller';
import { BrandTeamController } from './team/brand-team.controller';
import { BrandWidgetController } from './widget/brand-widget.controller';
import { BrandBillingController, BrandCouponsAdminController } from './billing/brand-billing.controller';
import { BrandBillingService } from './billing/brand-billing.service';
import { AdminAuthModule } from '../Admin-panel/admin-auth/admin-auth.module';
import { BrandTaxonomyController } from './taxonomy/brand-taxonomy.controller';
import { TaxonomyService } from './taxonomy/taxonomy.service';

// Services
import { BrandAuthService } from './auth/brand-auth.service';
import { BrandJwtStrategy } from './auth/brand-jwt.strategy';
import { BrandAuthGuard } from './auth/brand-auth.guard';
import { BrandProfileService } from './profile/brand-profile.service';
import { BrandCatalogService } from './catalog/brand-catalog.service';
import { BrandAnalyticsService } from './analytics/brand-analytics.service';
import { BrandAiStudioService } from './ai-studio/brand-ai-studio.service';
import { BrandVideoService } from './ai-studio/brand-video.service';
import { BrandReelService } from './ai-studio/brand-reel.service';
import { BrandModelService } from './ai-studio/model/brand-model.service';
import { BrandBiddingService } from './bidding/brand-bidding.service';
import { BrandDropsService } from './drops/brand-drops.service';
import { BrandUploadService } from './upload/brand-upload.service';
import { BrandWidgetService } from './widget/brand-widget.service';

@Module({
  imports: [
    PrismaModule,
    StorageModule.register(),
    ImageProviderModule,
    UploadsModule,
    MailerModule,
    SdkModule,
    AdminAuthModule,
    // No default secret: BrandJwtStrategy always passes its own, so brand tokens never share the user secret.
    JwtModule.register({}),
  ],
  controllers: [
    BrandAuthController,
    BrandProfileController,
    BrandCatalogController,
    BrandAnalyticsController,
    BrandAiStudioController,
    BrandModelController,
    BrandBiddingController,
    BrandDropsController,
    BrandUploadController,
    BrandTeamController,
    BrandWidgetController,
    BrandTaxonomyController,
    BrandBillingController,
    BrandCouponsAdminController,
  ],
  providers: [
    AppLogger,
    BrandAuthService,
    BrandJwtStrategy,
    BrandAuthGuard,
    BrandProfileService,
    BrandCatalogService,
    BrandAnalyticsService,
    BrandAiStudioService,
    BrandVideoService,
    BrandReelService,
    BrandModelService,
    BrandBiddingService,
    BrandDropsService,
    BrandUploadService,
    BrandWidgetService,
    TaxonomyService,
    BrandBillingService,
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
    TaxonomyService,
  ],
})
export class BrandPanelModule {}

