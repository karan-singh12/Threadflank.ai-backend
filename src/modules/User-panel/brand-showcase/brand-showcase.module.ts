import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { BrandPanelModule } from '../../Brand-panel/brand-panel.module';
import { BrandShowcaseController, DiscoverController, SpotlightController } from './brand-showcase.controller';
import { BrandShowcaseService } from './brand-showcase.service';
import { BrandDirectoryService } from './brand-directory.service';
import { BrandStoreService } from './brand-store.service';

@Module({
  imports: [PrismaModule, AuthModule, BrandPanelModule],
  controllers: [BrandShowcaseController, SpotlightController, DiscoverController],
  providers: [BrandShowcaseService, BrandDirectoryService, BrandStoreService],
})
export class BrandShowcaseModule {}
