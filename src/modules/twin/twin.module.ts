import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { TwinController } from "./twin.controller";
import { TwinService } from "./twin.service";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TwinController],
  providers: [TwinService],
  exports: [TwinService],
})
export class TwinModule {}
