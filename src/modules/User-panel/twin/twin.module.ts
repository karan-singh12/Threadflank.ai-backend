import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../../../prisma/prisma.module";
import { ImageProviderModule } from "../../../shared/image-provider/image-provider.module";
import { StorageModule } from "../../../shared/storage/storage.module";
import { PaymentsModule } from "../payments/payments.module";
import { TwinController } from "./twin.controller";
import { TwinService } from "./twin.service";

@Module({
  imports: [PrismaModule, AuthModule, ImageProviderModule, StorageModule.register(), PaymentsModule],
  controllers: [TwinController],
  providers: [TwinService],
  exports: [TwinService],
})
export class TwinModule {}
