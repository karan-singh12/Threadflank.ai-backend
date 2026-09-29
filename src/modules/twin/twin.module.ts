import { Module } from "@nestjs/common";
import { TwinController } from "./twin.controller";
import { TwinService } from "./twin.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../../auth/auth.module";
import { LocalStorageProvider } from "../../shared/storage/local-storage.provider";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TwinController],
  providers: [TwinService, LocalStorageProvider],
  exports: [TwinService],
})
export class TwinModule {}
