import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { BrandPanelModule } from '../../Brand-panel/brand-panel.module';
import { BrandShowcaseController, DiscoverController, SpotlightController } from './brand-showcase.controller';
import { BrandShowcaseService } from './brand-showcase.service';
import { BrandFollowService } from './brand-follow.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { BrandDirectoryService } from './brand-directory.service';
import { BrandStoreService } from './brand-store.service';
import { RankingsController } from './rankings.controller';
import { CampaignsPublicController } from './campaigns-public.controller';
import { CommunityPublicController } from './community-public.controller';
import { OffersPublicController } from '../../Brand-panel/promotions/promotions.controller';
import { CreatorCollabsController, CreatorLinksController } from '../../Brand-panel/creators/creators.controller';

@Module({
  imports: [PrismaModule, AuthModule, BrandPanelModule, NotificationsModule],
  controllers: [BrandShowcaseController, SpotlightController, DiscoverController, RankingsController, CampaignsPublicController, CommunityPublicController, OffersPublicController, CreatorCollabsController, CreatorLinksController],
  providers: [BrandShowcaseService, BrandDirectoryService, BrandStoreService, BrandFollowService],
})
export class BrandShowcaseModule {}
