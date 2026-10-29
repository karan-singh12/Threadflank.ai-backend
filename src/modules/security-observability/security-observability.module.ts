import { Module, Global } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { SecurityObservabilityService } from "./security-observability.service";
import { SecurityObservabilityController } from "./security-observability.controller";

@Global()
@Module({
  imports: [PrismaModule],
  controllers: [SecurityObservabilityController],
  providers: [SecurityObservabilityService],
  exports: [SecurityObservabilityService],
})
export class SecurityObservabilityModule {}

