import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TwinCircleController } from "./twin-circle.controller";
import { TwinCircleService } from "./twin-circle.service";

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule],
  controllers: [TwinCircleController],
  providers: [TwinCircleService],
  exports: [TwinCircleService],
})
export class TwinCircleModule {}
