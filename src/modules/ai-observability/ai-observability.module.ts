import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../../auth/auth.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { SdkModule } from '../../sdk';
import { AdminAiObservabilityController, AiUsageController } from './ai-observability.controller';
import { AiObservabilityService } from './ai-observability.service';

@Module({
  imports: [PrismaModule, AuthModule, AdminAuthModule, SdkModule],
  controllers: [AiUsageController, AdminAiObservabilityController],
  providers: [AiObservabilityService],
  exports: [AiObservabilityService],
})
export class AiObservabilityModule {}
