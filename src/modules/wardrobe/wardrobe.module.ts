import { Module } from "@nestjs/common";
import { WardrobeController } from "./wardrobe.controller";
import { WardrobeService } from "./wardrobe.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../../auth/auth.module";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [WardrobeController],
  providers: [WardrobeService],
  exports: [WardrobeService],
})
export class WardrobeModule {}
