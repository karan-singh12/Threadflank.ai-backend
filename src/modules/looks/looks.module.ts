import { Module } from "@nestjs/common";
import { LooksController } from "./looks.controller";
import { LooksService } from "./looks.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../../auth/auth.module";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [LooksController],
  providers: [LooksService],
})
export class LooksModule {}
