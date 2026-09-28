import { Module } from "@nestjs/common";
import { NotificationsService } from "./notifications.service";
import { NotificationsController } from "./notifications.controller";
import { PushNotificationGateway } from "./gateways/push-notification.gateway";
import { AppLogger } from "../../shared/logger/logger.service";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../../auth/auth.module";

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushNotificationGateway, AppLogger],
  exports: [NotificationsService, PushNotificationGateway],
})
export class NotificationsModule {}
