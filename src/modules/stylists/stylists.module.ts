import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthModule } from "../../auth/auth.module";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { AuditLogModule } from "../../shared/audit/audit-log.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { AdminStylistsController, StylistsController } from "./stylists.controller";
import { StylistsService } from "./stylists.service";

@Module({
  imports: [PrismaModule, AuthModule, AdminAuthModule, AuditLogModule, NotificationsModule],
  controllers: [StylistsController, AdminStylistsController],
  providers: [StylistsService],
})
export class StylistsModule {}
