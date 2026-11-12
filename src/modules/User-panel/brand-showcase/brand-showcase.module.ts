import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { BrandPanelModule } from '../../Brand-panel/brand-panel.module';
import { BrandShowcaseController, SpotlightController } from './brand-showcase.controller';
import { BrandShowcaseService } from './brand-showcase.service';

@Module({
  imports: [PrismaModule, AuthModule, BrandPanelModule],
  controllers: [BrandShowcaseController, SpotlightController],
  providers: [BrandShowcaseService],
})
export class BrandShowcaseModule {}
