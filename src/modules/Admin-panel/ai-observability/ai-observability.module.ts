import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AuthModule } from '../../User-panel/auth/auth.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { SdkModule } from '../../../sdk';
import { AdminAiObservabilityController } from './ai-observability.controller';
import { AiUsageController } from '../../User-panel/ai-observability/ai-usage.controller';
import { AiObservabilityService } from './ai-observability.service';

@Module({
  imports: [PrismaModule, AuthModule, AdminAuthModule, SdkModule],
  controllers: [AiUsageController, AdminAiObservabilityController],
  providers: [AiObservabilityService],
  exports: [AiObservabilityService],
})
export class AiObservabilityModule {}
