import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TwinCircleModule } from "../twin-circle/twin-circle.module";
import { SdkModule } from "../../sdk";
import { EventsController } from "./events.controller";
import { EventsService } from "./events.service";

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule, TwinCircleModule, SdkModule],
  controllers: [EventsController],
  providers: [EventsService],
})
export class EventsModule {}
