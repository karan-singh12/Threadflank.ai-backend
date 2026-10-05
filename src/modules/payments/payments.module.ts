import { Module } from "@nestjs/common";
import { AuthModule } from "../../auth/auth.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuditLogModule } from "../../shared/audit/audit-log.module";
import { AdminAuthModule } from "../admin-auth/admin-auth.module";
import { CreditsService } from "./credits.service";
import { PaymentsAdminController } from "./payments-admin.controller";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  imports: [PrismaModule, AuthModule, AuditLogModule, AdminAuthModule],
  controllers: [PaymentsController, PaymentsAdminController],
  providers: [PaymentsService, CreditsService],
  exports: [PaymentsService, CreditsService],
})
export class PaymentsModule {}
